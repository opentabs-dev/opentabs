/**
 * browser_add_tabs_to_group — adds tabs to an existing tab group.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const addTabsToGroup = defineBrowserTool({
  name: 'browser_add_tabs_to_group',
  description:
    'Add one or more tabs to an existing Chrome tab group. Use browser_list_tab_groups to find group IDs ' +
    'and browser_list_tabs to find tab IDs.',
  summary: 'Add tabs to a tab group',
  icon: 'folder-input',
  group: 'Tabs',
  input: z.object({
    groupId: z.number().int().nonnegative().describe('Target group ID. Use browser_list_tab_groups to find IDs.'),
    tabIds: z.array(z.number().int().positive()).min(1).describe('Tab IDs to add to the group.'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.addTabsToGroup', {
      groupId: args.groupId,
      tabIds: args.tabIds,
      tabId: args.tabIds[0],
    }),
});

export { addTabsToGroup };
