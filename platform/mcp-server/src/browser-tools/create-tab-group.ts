/**
 * browser_create_tab_group — creates a new tab group from the given tab IDs.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const createTabGroup = defineBrowserTool({
  name: 'browser_create_tab_group',
  description:
    'Create a new Chrome tab group from one or more tab IDs. Optionally set a title and color. ' +
    'Use browser_list_tabs to find tab IDs. Returns the new group ID, title, and color.',
  summary: 'Create a new tab group',
  icon: 'folder-plus',
  group: 'Tabs',
  input: z.object({
    tabIds: z
      .array(z.number().int().positive())
      .min(1)
      .describe('Tab IDs to include in the new group. Use browser_list_tabs to find IDs.'),
    title: z.string().optional().describe('Display name for the tab group'),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional()
      .describe('Tab group color. Defaults to Chrome-assigned color if omitted.'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.createTabGroup', {
      tabIds: args.tabIds,
      tabId: args.tabIds[0],
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.color !== undefined ? { color: args.color } : {}),
    }),
});

export { createTabGroup };
