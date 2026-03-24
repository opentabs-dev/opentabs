/**
 * browser_list_tabs — lists all open browser tabs across all connected profiles.
 * Dispatches to every active extension connection and merges the results,
 * annotating each tab with the connectionId of the profile that owns it.
 */

import { z } from 'zod';
import { dispatchToAllConnections } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const listTabs = defineBrowserTool({
  name: 'browser_list_tabs',
  description:
    'List all open browser tabs across all connected browser profiles. Returns tab ID, title, URL, active status, ' +
    'and connectionId for each tab. The connectionId identifies which browser profile owns the tab — use it with ' +
    'browser_open_tab to target a specific profile. ' +
    'Use the returned tab IDs with browser_close_tab, browser_navigate_tab, and browser_execute_script. ' +
    'Note: Returns ALL open tabs including potentially sensitive ones (banking, email, etc.). Tab URLs and titles may contain private information. Do not share tab information with plugin tools unless the user explicitly requests it.',
  summary: 'List all open browser tabs',
  icon: 'layout-list',
  group: 'Tabs',
  input: z.object({}),
  handler: async (_args, state) => {
    const responses = await dispatchToAllConnections(state, 'browser.listTabs', {});
    const allTabs: Array<Record<string, unknown>> = [];

    // Rebuild browser tab ownership index for cross-profile routing
    state.browserTabOwnership.clear();
    for (const { connectionId, result } of responses) {
      const tabs = Array.isArray(result) ? result : [];
      for (const tab of tabs) {
        const tabObj = tab as Record<string, unknown>;
        allTabs.push({ ...tabObj, connectionId });
        const id = tabObj.id;
        if (typeof id === 'number') {
          state.browserTabOwnership.set(id, connectionId);
        }
      }
    }
    return allTabs;
  },
});

export { listTabs };
