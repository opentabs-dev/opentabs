/**
 * browser_list_tab_groups — lists all Chrome tab groups across all connected profiles.
 * Dispatches to every active extension connection and merges the results,
 * annotating each group with the connectionId of the profile that owns it.
 */

import { z } from 'zod';
import { dispatchToAllConnections } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const listTabGroups = defineBrowserTool({
  name: 'browser_list_tab_groups',
  description:
    'List all Chrome tab groups across all connected browser profiles. Returns groupId, title, color, ' +
    'collapsed state, windowId, and connectionId for each group. Use the returned groupId with ' +
    'browser_add_tabs_to_group, browser_update_tab_group, and browser_list_tabs_in_group, and pass ' +
    'the connectionId in multi-profile setups so subsequent operations target the correct profile.',
  summary: 'List all tab groups',
  icon: 'layers',
  group: 'Tabs',
  input: z.object({
    windowId: z.number().int().optional().describe('Filter by window ID. Omit to list groups from all windows.'),
  }),
  handler: async (args, state) => {
    const query = args.windowId !== undefined ? { windowId: args.windowId } : {};
    const responses = await dispatchToAllConnections(state, 'browser.listTabGroups', query);
    const allGroups: Array<Record<string, unknown>> = [];
    for (const { connectionId, result } of responses) {
      const groups = Array.isArray(result) ? result : [];
      for (const group of groups) {
        allGroups.push({ ...(group as Record<string, unknown>), connectionId });
      }
    }
    return allGroups;
  },
});

export { listTabGroups };
