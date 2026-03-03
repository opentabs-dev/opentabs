import { IS_READY_TIMEOUT_MS, READINESS_POLL_INTERVAL_MS } from './constants.js';
import { forwardToSidePanel, sendTabStateNotification, sendToServer } from './messaging.js';
import { getAllPluginMeta } from './plugin-storage.js';
import { findAllMatchingTabs, urlMatchesPatterns } from './tab-matching.js';
import type { PluginMeta, PluginTabStateInfo } from './extension-messages.js';
import type { PluginTabInfo, TabState } from '@opentabs-dev/shared';

/**
 * Serialize a PluginTabStateInfo to a deterministic string for diff detection.
 * Changes in aggregate state, tab count, tab IDs, URLs, titles, or readiness
 * all produce different strings, ensuring notifications fire for any change.
 */
const serializeTabState = (info: PluginTabStateInfo): string => JSON.stringify({ state: info.state, tabs: info.tabs });

/**
 * Last-known tab state cache per plugin. Stores a serialized representation
 * of { state, tabs } so that changes in the tab list (new tabs, closed tabs,
 * URL changes, title changes, readiness changes) trigger notifications even
 * when the aggregate state hasn't changed.
 *
 * The cache is populated by sendTabSyncAll (called after sync.full) and
 * updated on every state change notification sent to the server.
 * It is cleared on disconnect and repopulated when sync.full arrives on
 * the next connection. Persists to chrome.storage.session (debounced 500ms)
 * so state survives MV3 service worker suspension.
 */
const lastKnownState = new Map<string, string>();

const LAST_KNOWN_STATE_SESSION_KEY = 'lastKnownState';

/** Debounce timer for session storage writes. */
let lastKnownStatePersistTimer: ReturnType<typeof setTimeout> | undefined;

/** Write the current lastKnownState Map to chrome.storage.session. */
const persistLastKnownStateToSession = (): void => {
  chrome.storage.session.set({ [LAST_KNOWN_STATE_SESSION_KEY]: Object.fromEntries(lastKnownState) }).catch(() => {
    // Best-effort persistence — session storage may not be available
  });
};

/** Schedule a debounced write to session storage (500ms). */
const scheduleLastKnownStatePersist = (): void => {
  if (lastKnownStatePersistTimer !== undefined) clearTimeout(lastKnownStatePersistTimer);
  lastKnownStatePersistTimer = setTimeout(() => {
    lastKnownStatePersistTimer = undefined;
    persistLastKnownStateToSession();
  }, 500);
};

/**
 * Per-plugin promise chain for serializing state computations. Concurrent
 * calls for the same plugin are chained sequentially so lastKnownState reads
 * and writes are atomic within each plugin. Different plugins run in parallel.
 */
const pluginLocks = new Map<string, Promise<void>>();

/**
 * Chain an async operation onto a plugin's lock so it runs sequentially
 * with any other pending operations for the same plugin. Returns the
 * promise for the operation itself (rejections are logged on the lock
 * chain but propagated to the caller via the returned promise).
 *
 * After the operation completes, the lock is reset to a resolved promise
 * if no new work has been enqueued, breaking the promise chain to allow
 * fulfilled promises to be garbage collected.
 */
const withPluginLock = (pluginName: string, fn: () => Promise<void>): Promise<void> => {
  const prev = pluginLocks.get(pluginName) ?? Promise.resolve();
  const operation = prev.then(fn);
  const lock = operation.catch((err: unknown) => {
    console.warn('[opentabs] tab state operation failed for plugin', pluginName, ':', err);
  });
  pluginLocks.set(pluginName, lock);
  void lock.then(() => {
    if (pluginLocks.get(pluginName) === lock) {
      pluginLocks.set(pluginName, Promise.resolve());
    }
  });
  return operation;
};

/**
 * Probe a single tab for adapter readiness. Returns true if the adapter's
 * isReady() returns true within the timeout, false otherwise.
 */
const probeTabReadiness = async (tabId: number, pluginName: string): Promise<boolean> => {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (pName: string) => {
          const ot = (globalThis as Record<string, unknown>).__openTabs as
            | { adapters?: Record<string, { isReady?: unknown }> }
            | undefined;
          const adapter = ot?.adapters?.[pName];
          if (!adapter || typeof adapter !== 'object') return false;
          if (typeof adapter.isReady !== 'function') return false;
          return await (adapter.isReady as () => Promise<boolean>)();
        },
        args: [pluginName],
      }),
      new Promise<null>(resolve => {
        timerId = setTimeout(() => resolve(null), IS_READY_TIMEOUT_MS);
      }),
    ]);

    if (results === null) {
      console.warn(`[opentabs] isReady() timed out for plugin "${pluginName}" in tab ${tabId}`);
      return false;
    }

    const readyResult = results[0] as { result?: unknown } | undefined;
    return readyResult?.result === true;
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
};

/**
 * Compute the tab state for a single plugin by checking all matching tabs
 * for adapter readiness. Probes every matching tab and returns the full list
 * with per-tab readiness. Aggregate state: 'ready' if any tab is ready,
 * 'unavailable' if tabs exist but none are ready, 'closed' if no tabs match.
 */
const computePluginTabState = async (plugin: PluginMeta): Promise<PluginTabStateInfo> => {
  const matchingTabs = await findAllMatchingTabs(plugin);
  if (matchingTabs.length === 0) {
    return { state: 'closed', tabs: [] };
  }

  const tabInfos: PluginTabInfo[] = [];

  for (const tab of matchingTabs) {
    if (tab.id === undefined) continue;
    let ready = false;
    try {
      ready = await probeTabReadiness(tab.id, plugin.name);
    } catch (err) {
      console.warn(`[opentabs] computePluginTabState failed for plugin ${plugin.name} in tab ${tab.id}:`, err);
    }
    tabInfos.push({
      tabId: tab.id,
      url: tab.url ?? '',
      title: tab.title ?? '',
      ready,
    });
  }

  const hasReady = tabInfos.some(t => t.ready);
  const state: TabState = hasReady ? 'ready' : 'unavailable';

  return { state, tabs: tabInfos };
};

/**
 * Scan all open tabs and send tab.syncAll to MCP server with current state
 * of all known plugins. Called after sync.full is processed so the extension
 * has up-to-date plugin metadata before reporting tab states.
 *
 * Also populates the lastKnownState cache so subsequent checkTabChanged /
 * checkTabRemoved calls can suppress redundant notifications.
 */
const sendTabSyncAll = async (): Promise<void> => {
  const index = await getAllPluginMeta();
  const plugins = Object.values(index);
  if (plugins.length === 0) return;

  const settled = await Promise.allSettled(
    plugins.map(async plugin => [plugin.name, await computePluginTabState(plugin)] as const),
  );
  const entries: (readonly [string, PluginTabStateInfo])[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      entries.push(result.value);
    } else {
      console.warn('[opentabs] Tab state computation failed during syncAll:', result.reason);
    }
  }
  if (entries.length === 0) return;
  const tabSyncPayload: Record<string, PluginTabStateInfo> = Object.fromEntries(entries);

  // Write each plugin's state through the per-plugin lock so concurrent
  // checkTabChanged / checkTabRemoved calls are properly serialized.
  const pluginNamesInSync = new Set<string>();
  await Promise.all(
    entries.map(([pluginName, stateInfo]) => {
      pluginNamesInSync.add(pluginName);
      return withPluginLock(pluginName, () => {
        lastKnownState.set(pluginName, serializeTabState(stateInfo));
        scheduleLastKnownStatePersist();
        return Promise.resolve();
      });
    }),
  );
  // Remove entries for plugins no longer in the index
  let removedStale = false;
  for (const key of lastKnownState.keys()) {
    if (!pluginNamesInSync.has(key)) {
      lastKnownState.delete(key);
      pluginLocks.delete(key);
      removedStale = true;
    }
  }
  if (removedStale) scheduleLastKnownStatePersist();

  sendToServer({
    jsonrpc: '2.0',
    method: 'tab.syncAll',
    params: { tabs: tabSyncPayload },
  });

  // Forward individual tab.stateChanged messages to the side panel so it
  // gets initial tab states on connect without a separate fetch round-trip.
  for (const [pluginName, stateInfo] of entries) {
    forwardToSidePanel({
      type: 'sp:serverMessage',
      data: {
        jsonrpc: '2.0',
        method: 'tab.stateChanged',
        params: { plugin: pluginName, state: stateInfo.state, tabs: stateInfo.tabs },
      },
    });
  }
};

/**
 * Write the current lastKnownState Map to chrome.storage.session immediately,
 * cancelling any pending debounced write. Called after sync.full populates
 * the cache to ensure critical state survives MV3 service worker suspension
 * without waiting for the 500ms debounce window.
 */
const flushLastKnownStateToSession = (): void => {
  if (lastKnownStatePersistTimer !== undefined) {
    clearTimeout(lastKnownStatePersistTimer);
    lastKnownStatePersistTimer = undefined;
  }
  persistLastKnownStateToSession();
};

/**
 * Clear the last-known state cache. Called on WebSocket disconnect so the
 * next connect triggers a full sync without stale cache interference.
 */
const clearTabStateCache = (): void => {
  lastKnownState.clear();
  pluginLocks.clear();
  if (lastKnownStatePersistTimer !== undefined) {
    clearTimeout(lastKnownStatePersistTimer);
    lastKnownStatePersistTimer = undefined;
  }
  chrome.storage.session.remove(LAST_KNOWN_STATE_SESSION_KEY).catch(() => {
    // Best-effort removal
  });
};

/**
 * Remove tab-state tracking entries for a single plugin. Called when a plugin
 * is uninstalled or removed during sync.full so the maps do not grow
 * unboundedly during long-running sessions.
 */
const clearPluginTabState = (pluginName: string): void => {
  const had = lastKnownState.has(pluginName);
  lastKnownState.delete(pluginName);
  pluginLocks.delete(pluginName);
  if (had) scheduleLastKnownStatePersist();
};

/**
 * Update the last-known state for a single plugin, serialized through the
 * plugin lock so it cannot interleave with checkTabChanged / checkTabRemoved
 * reads and writes for the same plugin. Called by handlePluginUpdate in
 * message-router.ts after computing the new state via computePluginTabState.
 */
const updateLastKnownState = (pluginName: string, stateInfo: PluginTabStateInfo): Promise<void> =>
  withPluginLock(pluginName, () => {
    lastKnownState.set(pluginName, serializeTabState(stateInfo));
    scheduleLastKnownStatePersist();
    return Promise.resolve();
  });

/**
 * Return a snapshot of last-known tab state info for all plugins.
 * Each entry is the serialized { state, tabs } string. Callers that need
 * just the aggregate TabState should parse the JSON and extract `.state`.
 */
const getLastKnownStates = (): ReadonlyMap<string, string> => lastKnownState;

/**
 * Load the lastKnownState cache from chrome.storage.session and populate the
 * in-memory Map. Called on service worker wake to restore state that was
 * persisted before suspension.
 */
const loadLastKnownStateFromSession = async (): Promise<void> => {
  lastKnownState.clear();
  try {
    const data = await chrome.storage.session.get(LAST_KNOWN_STATE_SESSION_KEY);
    const stored = data[LAST_KNOWN_STATE_SESSION_KEY] as Record<string, string> | undefined;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'string') {
          lastKnownState.set(key, value);
        }
      }
    }
  } catch {
    // Session storage may not be available — keep current cache
  }
};

/** Extract the aggregate TabState from a serialized cache entry. */
const getAggregateState = (serialized: string): TabState => {
  try {
    const parsed = JSON.parse(serialized) as { state: string };
    const validStates = new Set<string>(['closed', 'unavailable', 'ready']);
    return validStates.has(parsed.state) ? (parsed.state as TabState) : 'closed';
  } catch {
    return 'closed';
  }
};

/**
 * Compute state for each affected plugin, diff against the lastKnownState
 * cache, and send tab.stateChanged only when the state actually changed.
 * Each plugin's computation is serialized via withPluginLock to prevent
 * interleaving with concurrent calls or updateLastKnownState writes.
 */
const notifyAffectedPlugins = async (affectedPlugins: PluginMeta[]): Promise<void> => {
  await Promise.all(
    affectedPlugins.map(plugin =>
      withPluginLock(plugin.name, async () => {
        const newState = await computePluginTabState(plugin);

        // Suppress redundant notifications: only send if state or tab list changed.
        // Serialized comparison catches tab list changes (new tabs, closed tabs,
        // URL changes, title changes, readiness changes) even when the aggregate
        // state is unchanged.
        const serialized = serializeTabState(newState);
        const previous = lastKnownState.get(plugin.name);
        if (previous === serialized) return;

        // Update the cache before sending so rapid sequential events see the
        // latest state and don't produce duplicate notifications.
        lastKnownState.set(plugin.name, serialized);
        scheduleLastKnownStatePersist();

        sendTabStateNotification(plugin.name, newState);
      }),
    ),
  );
};

/**
 * Check if a tab removal affects any plugin's tab state. All plugins are
 * checked because chrome.tabs.get fails for removed tabs and onRemoved
 * provides no URL, so pattern matching is not possible.
 */
const checkTabRemoved = async (_removedTabId: number): Promise<void> => {
  const index = await getAllPluginMeta();
  const plugins = Object.values(index);
  if (plugins.length === 0) return;

  await notifyAffectedPlugins(plugins);
};

/**
 * Check if a tab URL change or page load affects any plugin's tab state.
 * Only plugins whose patterns match the changed URL or that have an active
 * (non-closed) state are checked, avoiding O(n × scripting calls) per event.
 *
 * Optimized paths:
 *   - URL change: plugins matching the new URL OR plugins with active state
 *   - status=complete: the tab's URL is fetched once and matched against all
 *     plugin patterns, avoiding per-plugin chrome.tabs queries
 */
const checkTabChanged = async (changedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo): Promise<void> => {
  const index = await getAllPluginMeta();
  const plugins = Object.values(index);
  if (plugins.length === 0) return;

  let affectedPlugins: PluginMeta[];

  if (changeInfo.url) {
    // URL changed — check plugins matching the new URL plus plugins with
    // active state (not 'closed'). Active plugins may have been on this tab
    // before navigation, so recomputing their state discovers they no longer
    // have a matching tab and transitions them to 'closed'.
    const changedUrl = changeInfo.url;
    affectedPlugins = plugins.filter(p => {
      if (urlMatchesPatterns(changedUrl, p.urlPatterns)) return true;
      const cached = lastKnownState.get(p.name);
      return cached !== undefined && getAggregateState(cached) !== 'closed';
    });
  } else if (changeInfo.status === 'complete') {
    // Page finished loading — fetch the tab's current URL once and filter
    // plugins by pattern match instead of calling findMatchingTab per plugin.
    let tabUrl: string | undefined;
    try {
      const tab = await chrome.tabs.get(changedTabId);
      tabUrl = tab.url;
    } catch {
      // Tab may have been closed between event and handler — nothing to do
      return;
    }
    if (!tabUrl) return;
    affectedPlugins = plugins.filter(p => {
      if (urlMatchesPatterns(tabUrl, p.urlPatterns)) return true;
      const cached = lastKnownState.get(p.name);
      return cached !== undefined && getAggregateState(cached) !== 'closed';
    });
  } else {
    return;
  }

  if (affectedPlugins.length === 0) return;

  await notifyAffectedPlugins(affectedPlugins);
};

// ---------------------------------------------------------------------------
// Periodic readiness polling
// ---------------------------------------------------------------------------

/** Timer handle for the periodic readiness poll, undefined when not running. */
let readinessPollTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Guard flag that prevents overlapping poll cycles. Set to true when a poll
 * is in progress and reset to false when it completes. If a new interval
 * tick fires while a poll is still running, the tick is skipped.
 */
let readinessPollRunning = false;

/**
 * Run a single readiness poll: re-probe all plugins that have a non-closed
 * aggregate state. Plugins in 'closed' state have no matching tabs, so
 * probing them is pointless. Both 'ready' and 'unavailable' plugins are
 * probed — 'ready' tabs may have lost auth, and 'unavailable' tabs may
 * have gained it.
 */
const runReadinessPoll = async (): Promise<void> => {
  if (readinessPollRunning) return;
  readinessPollRunning = true;
  try {
    const index = await getAllPluginMeta();
    const plugins = Object.values(index);
    if (plugins.length === 0) return;

    const activePlugins = plugins.filter(p => {
      const cached = lastKnownState.get(p.name);
      return cached !== undefined && getAggregateState(cached) !== 'closed';
    });
    if (activePlugins.length === 0) return;

    await notifyAffectedPlugins(activePlugins);
  } catch (err: unknown) {
    console.warn('[opentabs] readiness poll failed:', err);
  } finally {
    readinessPollRunning = false;
  }
};

/**
 * Start periodic isReady() re-evaluation. Safe to call multiple times —
 * subsequent calls are no-ops while a poll is already scheduled.
 * Should be called after sendTabSyncAll completes (i.e., after sync.full)
 * so the lastKnownState cache is populated before the first poll tick.
 */
const startReadinessPoll = (): void => {
  if (readinessPollTimer !== undefined) return;
  readinessPollTimer = setInterval(() => {
    runReadinessPoll().catch((err: unknown) => {
      console.warn('[opentabs] readiness poll tick failed:', err);
    });
  }, READINESS_POLL_INTERVAL_MS);
};

/**
 * Stop periodic isReady() re-evaluation. Called on WebSocket disconnect
 * since there is no server to notify about state changes.
 */
const stopReadinessPoll = (): void => {
  if (readinessPollTimer !== undefined) {
    clearInterval(readinessPollTimer);
    readinessPollTimer = undefined;
  }
  readinessPollRunning = false;
};

export {
  checkTabChanged,
  checkTabRemoved,
  clearPluginTabState,
  clearTabStateCache,
  computePluginTabState,
  flushLastKnownStateToSession,
  getAggregateState,
  getLastKnownStates,
  loadLastKnownStateFromSession,
  sendTabSyncAll,
  startReadinessPoll,
  stopReadinessPoll,
  updateLastKnownState,
};
