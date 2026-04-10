/**
 * browser_list_tabs_in_group — lists all tabs belonging to a specific tab group.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const listTabsInGroup = defineBrowserTool({
  name: 'browser_list_tabs_in_group',
  description:
    'List all tabs in a specific Chrome tab group. Returns tab ID, title, URL, active status, ' +
    'and window ID for each tab. Use browser_list_tab_groups to find group IDs and the owning connectionId. ' +
    'In multi-profile setups, pass the connectionId from browser_list_tab_groups so the query ' +
    'reaches the profile that owns the group.',
  summary: 'List tabs in a tab group',
  icon: 'list',
  group: 'Tabs',
  input: z.object({
    groupId: z
      .number()
      .int()
      .nonnegative()
      .describe('Group ID to list tabs for. Use browser_list_tab_groups to find IDs.'),
    connectionId: z
      .string()
      .optional()
      .describe(
        'Target a specific browser profile. Get from browser_list_tab_groups. ' +
          'Required in multi-profile setups so the query reaches the profile that owns the group.',
      ),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.listTabsInGroup', {
      groupId: args.groupId,
      ...(args.connectionId ? { connectionId: args.connectionId } : {}),
    }),
});

export { listTabsInGroup };
