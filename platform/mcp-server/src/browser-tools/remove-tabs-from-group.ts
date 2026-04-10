/**
 * browser_remove_tabs_from_group — removes tabs from their current group (ungroups them).
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const removeTabsFromGroup = defineBrowserTool({
  name: 'browser_remove_tabs_from_group',
  description:
    'Remove one or more tabs from their current Chrome tab group (ungroup them). ' +
    'Use browser_list_tabs to find tab IDs. Tabs that are not in any group are silently ignored.',
  summary: 'Remove tabs from a tab group',
  icon: 'folder-output',
  group: 'Tabs',
  input: z.object({
    tabIds: z
      .array(z.number().int().positive())
      .min(1)
      .describe('Tab IDs to remove from their current group (ungroup).'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.removeTabsFromGroup', {
      tabIds: args.tabIds,
      tabId: args.tabIds[0],
    }),
});

export { removeTabsFromGroup };
