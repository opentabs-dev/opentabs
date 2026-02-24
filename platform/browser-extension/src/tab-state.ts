import { IS_READY_TIMEOUT_MS } from './constants.js';
import { forwardToSidePanel, sendTabStateNotification, sendToServer } from './messaging.js';
import { getAllPluginMeta } from './plugin-storage.js';
import { findAllMatchingTabs, urlMatchesPatterns } from './tab-matching.js';
import type { PluginMeta, PluginTabStateInfo } from './extension-messages.js';
import type { TabState } from '@opentabs-dev/shared';

/**
 * Last-known tab state cache per plugin. Used by checkTabStateChanges to
 * suppress redundant tab.stateChanged notifications when a tab event fires
 * but the plugin's effective state hasn't actually changed (e.g., a page
 * reload where the plugin was "ready" before and is still "ready" after).
 *
 * The cache is populated by sendTabSyncAll (full sync on connect) and
 * updated on every state change notification sent to the server.
 * It is cleared on disconnect (the background script handles reconnect
 * via sendTabSyncAll which repopulates it).
 */
const lastKnownState = new Map<string, TabState>();

/**
 * Per-plugin promise chain for serializing state computations. Concurrent
 * checkTabStateChanges calls for the same plugin are chained sequentially
 * so lastKnownState reads and writes are atomic within each plugin. Different
 * plugins still run in parallel.
 */
const pluginLocks = new Map<string, Promise<void>>();

/**
 * Probe a single tab for adapter readiness. Returns true if the adapter's
 * isReady() returns true within the timeout, false otherwise.
 */
const probeTabReadiness = async (tabId: number, pluginName: string): Promise<boolean> => {
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
    new Promise<null>(resolve => setTimeout(() => resolve(null), IS_READY_TIMEOUT_MS)),
  ]);

  if (results === null) {
    console.warn(`[opentabs] isReady() timed out for plugin "${pluginName}" in tab ${tabId}`);
    return false;
  }

  const readyResult = results[0] as { result?: unknown } | undefined;
  return readyResult?.result === true;
};

/**
 * Compute the tab state for a single plugin by checking all matching tabs
 * for adapter readiness. Reports 'ready' if ANY matching tab is ready,
 * 'unavailable' if tabs exist but none are ready, 'closed' if no tabs match.
 */
export const computePluginTabState = async (plugin: PluginMeta): Promise<PluginTabStateInfo> => {
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
 * of all known plugins. Called on WebSocket connect/reconnect.
 *
 * Also populates the lastKnownState cache so subsequent checkTabStateChanges
 * calls can suppress redundant notifications.
 */
export const sendTabSyncAll = async (): Promise<void> => {
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

  // Populate the cache from the full sync
  lastKnownState.clear();
  for (const [pluginName, stateInfo] of entries) {
    lastKnownState.set(pluginName, stateInfo.state);
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
export const clearTabStateCache = (): void => {
  lastKnownState.clear();
  pluginLocks.clear();
};

/**
 * Remove tab-state tracking entries for a single plugin. Called when a plugin
 * is uninstalled or removed during sync.full so the maps do not grow
 * unboundedly during long-running sessions.
 */
export const clearPluginTabState = (pluginName: string): void => {
  lastKnownState.delete(pluginName);
  pluginLocks.delete(pluginName);
};

/**
 * Update the last-known state for a single plugin. Called by handlePluginUpdate
 * in message-router.ts after computing the new state via computePluginTabState,
 * so the cache stays in sync when tab.stateChanged is sent directly (bypassing
 * checkTabStateChanges).
 */
export const updateLastKnownState = (pluginName: string, state: TabState): void => {
  lastKnownState.set(pluginName, state);
};

/** Return a snapshot of last-known tab states for all plugins. */
export const getLastKnownStates = (): ReadonlyMap<string, TabState> => lastKnownState;

/**
 * Check if a tab change (URL update or removal) affects any plugin's tab state,
 * and send tab.stateChanged notifications for affected plugins whose state has
 * actually changed since the last notification.
 *
 * Optimized to avoid O(n × scripting calls) per tab event:
 *   - On URL change: plugins whose patterns match the new URL OR plugins with active
 *     state (not 'closed') are checked, catching navigate-away transitions
 *   - On status=complete: the changed tab's URL is fetched once and matched against all
 *     plugin patterns, avoiding a findMatchingTab (which queries chrome.tabs) per plugin
 *   - On tab removal: all plugins are checked (chrome.tabs.get fails for removed tabs
 *     and onRemoved provides no URL)
 *
 * Redundant notifications are suppressed: if a plugin's computed state matches
 * the lastKnownState cache, no tab.stateChanged is sent. This avoids unnecessary
 * WebSocket traffic on events like page reloads where the effective state is unchanged.
 */
export const checkTabStateChanges = async (
  changedTabId: number,
  changeInfo?: { url?: string; status?: string },
  removed?: boolean,
): Promise<void> => {
  const index = await getAllPluginMeta();
  const plugins = Object.values(index);
  if (plugins.length === 0) return;

  // Pre-filter: determine which plugins could be affected by this tab event
  // without making per-plugin chrome.tabs or chrome.scripting calls.
  let affectedPlugins: PluginMeta[];

  if (removed) {
    // Tab was removed — any plugin with active state could be affected.
    // chrome.tabs.get fails for removed tabs and onRemoved provides no URL,
    // so all plugins must be checked.
    affectedPlugins = plugins;
  } else if (changeInfo?.url) {
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
  } else if (changeInfo?.status === 'complete') {
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

  const results = await Promise.allSettled(
    affectedPlugins.map(plugin => {
      // Chain onto the existing lock for this plugin so concurrent calls
      // for the same plugin are serialized. Different plugins run in parallel.
      const prev = pluginLocks.get(plugin.name) ?? Promise.resolve();
      const next = prev.then(async () => {
        const newState = await computePluginTabState(plugin);

        // Suppress redundant notifications: only send if state actually changed
        const previous = lastKnownState.get(plugin.name);
        if (previous === newState.state) return;

        // Update the cache before sending so rapid sequential events see the
        // latest state and don't produce duplicate notifications.
        lastKnownState.set(plugin.name, newState.state);

        sendTabStateNotification(plugin.name, newState);
      });
      pluginLocks.set(
        plugin.name,
        next.catch((err: unknown) => {
          console.warn('[opentabs] tab state check failed for plugin', plugin.name, ':', err);
        }),
      );
      return next;
    }),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[opentabs] Tab state check failed for a plugin:', result.reason);
    }
  }
};
