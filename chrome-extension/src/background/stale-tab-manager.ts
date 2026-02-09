/**
 * Stale Tab Manager
 *
 * Detects content scripts that became stale after an extension reload and
 * refreshes the affected tabs so they re-inject fresh scripts.
 */

import { MessageTypes, SERVICE_IDS, SERVICE_URL_PATTERNS } from '@extension/shared';

// Track which tabs have already been refreshed this session (prevents refresh loops)
const refreshedTabs = new Set<number>();

/**
 * Check if content scripts in service tabs are stale and refresh them if needed.
 * Sends a PING to each service tab; if no PONG response arrives within 2 seconds,
 * the tab is considered stale and reloaded.
 */
const checkAndRefreshStaleTabs = async (): Promise<void> => {
  const tabQueries = SERVICE_IDS.map(id => chrome.tabs.query({ url: SERVICE_URL_PATTERNS[id] }));
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
