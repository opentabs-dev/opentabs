/**
 * Stale Tab Manager
 *
 * Detects content scripts that became stale after an extension reload and
 * refreshes the affected tabs so they re-inject fresh scripts.
 *
 * Ported from chrome-extension/src/background/stale-tab-manager.ts.
 * Key changes:
 * - Imports from @opentabs/core instead of @extension/shared
 * - Uses dynamic getServiceIds() and getServiceUrlPatterns() instead of
 *   static SERVICE_IDS and SERVICE_URL_PATTERNS
 */

import { MessageTypes, getServiceIds, getServiceUrlPatterns } from '@opentabs/core';

// Track which tabs have already been refreshed this session (prevents refresh loops)
const refreshedTabs = new Set<number>();

/**
 * Check if content scripts in service tabs are stale and refresh them if needed.
 * Sends a PING to each service tab; if no PONG response arrives within 2 seconds,
 * the tab is considered stale and reloaded.
 */
const checkAndRefreshStaleTabs = async (): Promise<void> => {
  const serviceIds = getServiceIds();
  const urlPatterns = getServiceUrlPatterns();

  const tabQueries = serviceIds.map(id => {
    const patterns = urlPatterns[id];
    return patterns ? chrome.tabs.query({ url: patterns }) : Promise.resolve([]);
  });
  const tabResults = await Promise.all(tabQueries);
  const allTabs = tabResults.flat();
  let refreshedCount = 0;

  for (const tab of allTabs) {
    if (!tab.id || refreshedTabs.has(tab.id)) continue;

    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: MessageTypes.PING }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
      ]);

      if (!response) {
        refreshedTabs.add(tab.id);
        await chrome.tabs.reload(tab.id);
        refreshedCount++;
      }
    } catch {
      // Error communicating with tab — likely needs refresh
      refreshedTabs.add(tab.id);
      try {
        await chrome.tabs.reload(tab.id);
        refreshedCount++;
      } catch {
        // Tab might have been closed
      }
    }
  }

  if (refreshedCount > 0) {
    console.log(`[OpenTabs] Refreshed ${refreshedCount} stale tab(s)`);
  }
};

export { checkAndRefreshStaleTabs };
