/**
 * browser_update_tab_group — updates a tab group's properties (title, color, collapsed state).
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const updateTabGroup = defineBrowserTool({
  name: 'browser_update_tab_group',
  description:
    "Update a Chrome tab group's title, color, or collapsed state. " + 'Use browser_list_tab_groups to find group IDs.',
  summary: 'Update a tab group',
  icon: 'folder-pen',
  group: 'Tabs',
  input: z.object({
    groupId: z.number().int().nonnegative().describe('Group ID to update. Use browser_list_tab_groups to find IDs.'),
    title: z.string().optional().describe('New display name for the group'),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional()
      .describe('New color for the group'),
    collapsed: z.boolean().optional().describe('Whether the group should be collapsed'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.updateTabGroup', {
      groupId: args.groupId,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.color !== undefined ? { color: args.color } : {}),
      ...(args.collapsed !== undefined ? { collapsed: args.collapsed } : {}),
    }),
});

export { updateTabGroup };
