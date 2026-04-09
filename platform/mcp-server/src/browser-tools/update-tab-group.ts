/**
 * browser_update_tab_group — updates a tab group's properties (title, color, collapsed state).
 *
 * Chrome tab group IDs are scoped to a single browser profile, so the dispatch must be
 * routed to the correct extension connection in multi-profile setups. The caller passes
 * the `connectionId` returned by `browser_list_tab_groups` to ensure the operation hits
 * the profile that owns the target group.
 */

import { TAB_GROUP_COLORS } from '@opentabs-dev/shared';
import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const updateTabGroup = defineBrowserTool({
  name: 'browser_update_tab_group',
  description:
    "Update a Chrome tab group's title, color, or collapsed state. " +
    'At least one of title, color, or collapsed must be provided. ' +
    'Use browser_list_tab_groups to find group IDs and the owning connectionId. ' +
    'In multi-profile setups, pass the connectionId from browser_list_tab_groups so the ' +
    'update is dispatched to the correct browser profile.',
  summary: 'Update a tab group',
  icon: 'folder-pen',
  group: 'Tabs',
  input: z
    .object({
      groupId: z.number().int().nonnegative().describe('Group ID to update. Use browser_list_tab_groups to find IDs.'),
      title: z.string().optional().describe('New display name for the group'),
      color: z.enum(TAB_GROUP_COLORS).optional().describe('New color for the group'),
      collapsed: z.boolean().optional().describe('Whether the group should be collapsed'),
      connectionId: z
        .string()
        .optional()
        .describe(
          'Target a specific browser profile. Get from browser_list_tab_groups. ' +
            'Required in multi-profile setups so the update reaches the profile that owns the group.',
        ),
    })
    .refine(args => args.title !== undefined || args.color !== undefined || args.collapsed !== undefined, {
      message: 'At least one of title, color, or collapsed must be provided',
    }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.updateTabGroup', {
      groupId: args.groupId,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.color !== undefined ? { color: args.color } : {}),
      ...(args.collapsed !== undefined ? { collapsed: args.collapsed } : {}),
      ...(args.connectionId !== undefined ? { connectionId: args.connectionId } : {}),
    }),
});

export { updateTabGroup };
