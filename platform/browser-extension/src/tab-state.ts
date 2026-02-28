import { IS_READY_TIMEOUT_MS } from './constants.js';
import { forwardToSidePanel, sendTabStateNotification, sendToServer } from './messaging.js';
import { getAllPluginMeta } from './plugin-storage.js';
import { findAllMatchingTabs, urlMatchesPatterns } from './tab-matching.js';
import type { PluginMeta, PluginTabStateInfo } from './extension-messages.js';
import type { TabState } from '@opentabs-dev/shared';

/**
 * Last-known tab state cache per plugin. Used by checkTabChanged and
 * checkTabRemoved to suppress redundant tab.stateChanged notifications
 * when a tab event fires but the plugin's effective state hasn't actually
 * changed (e.g., a page reload where the plugin was "ready" before and
 * is still "ready" after).
 *
 * The cache is populated by sendTabSyncAll (called after sync.full) and
 * updated on every state change notification sent to the server.
 * It is cleared on disconnect and repopulated when sync.full arrives on
 * the next connection.
 */
const lastKnownState = new Map<string, TabState>();

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
 * for adapter readiness. Reports 'ready' if ANY matching tab is ready,
 * 'unavailable' if tabs exist but none are ready, 'closed' if no tabs match.
 */
const computePluginTabState = async (plugin: PluginMeta): Promise<PluginTabStateInfo> => {
  const tabs = await findAllMatchingTabs(plugin);
  if (tabs.length === 0) {
    return { state: 'closed', tabId: null, url: null };
  }

  // Track the first unavailable tab for fallback reporting
  let firstUnavailable: chrome.tabs.Tab | undefined;

  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      const ready = await probeTabReadiness(tab.id, plugin.name);
      if (ready) {
        return { state: 'ready', tabId: tab.id, url: tab.url ?? null };
      }
      firstUnavailable ??= tab;
    } catch (err) {
      console.warn(`[opentabs] computePluginTabState failed for plugin ${plugin.name} in tab ${tab.id}:`, err);
      firstUnavailable ??= tab;
    }
  }

  // All matching tabs exist but none are ready
  const fallbackTab = firstUnavailable ?? tabs[0];
  return {
    state: 'unavailable',
    tabId: fallbackTab?.id ?? null,
    url: fallbackTab?.url ?? null,
  };
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
        lastKnownState.set(pluginName, stateInfo.state);
        return Promise.resolve();
      });
    }),
  );
  // Remove entries for plugins no longer in the index
  for (const key of lastKnownState.keys()) {
    if (!pluginNamesInSync.has(key)) {
      lastKnownState.delete(key);
      pluginLocks.delete(key);
    }
  }

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
        params: { plugin: pluginName, state: stateInfo.state, tabId: stateInfo.tabId, url: stateInfo.url },
      },
    });
  }
};

/**
 * Clear the last-known state cache. Called on WebSocket disconnect so the
 * next connect triggers a full sync without stale cache interference.
 */
const clearTabStateCache = (): void => {
  lastKnownState.clear();
  pluginLocks.clear();
};

/**
 * Remove tab-state tracking entries for a single plugin. Called when a plugin
 * is uninstalled or removed during sync.full so the maps do not grow
 * unboundedly during long-running sessions.
 */
const clearPluginTabState = (pluginName: string): void => {
  lastKnownState.delete(pluginName);
  pluginLocks.delete(pluginName);
};

/**
 * Update the last-known state for a single plugin, serialized through the
 * plugin lock so it cannot interleave with checkTabChanged / checkTabRemoved
 * reads and writes for the same plugin. Called by handlePluginUpdate in
 * message-router.ts after computing the new state via computePluginTabState.
 */
const updateLastKnownState = (pluginName: string, state: TabState): Promise<void> =>
  withPluginLock(pluginName, () => {
    lastKnownState.set(pluginName, state);
    return Promise.resolve();
  });

/** Return a snapshot of last-known tab states for all plugins. */
const getLastKnownStates = (): ReadonlyMap<string, TabState> => lastKnownState;

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

        // Suppress redundant notifications: only send if state actually changed
        const previous = lastKnownState.get(plugin.name);
        if (previous === newState.state) return;

        // Update the cache before sending so rapid sequential events see the
        // latest state and don't produce duplicate notifications.
        lastKnownState.set(plugin.name, newState.state);

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
    affectedPlugins = plugins.filter(
      p =>
        urlMatchesPatterns(changedUrl, p.urlPatterns) ||
        (lastKnownState.has(p.name) && lastKnownState.get(p.name) !== 'closed'),
    );
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
    affectedPlugins = plugins.filter(
      p =>
        urlMatchesPatterns(tabUrl, p.urlPatterns) ||
        (lastKnownState.has(p.name) && lastKnownState.get(p.name) !== 'closed'),
    );
  } else {
    return;
  }

  if (affectedPlugins.length === 0) return;

  await notifyAffectedPlugins(affectedPlugins);
};

export {
  checkTabChanged,
  checkTabRemoved,
  clearPluginTabState,
  clearTabStateCache,
  computePluginTabState,
  getLastKnownStates,
  sendTabSyncAll,
  updateLastKnownState,
};
