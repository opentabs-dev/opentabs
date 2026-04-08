import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

export const listUserGroupMembers = defineTool({
  name: 'list_user_group_members',
  displayName: 'List User Group Members',
  description:
    'List member user IDs of a specific user group. Use list_user_groups to find group IDs, then get_user_info to resolve user IDs to names.',
  summary: 'List members of a user group',
  icon: 'users',
  group: 'User Groups',
  input: z.object({
    usergroup: z.string().describe('User group ID (from list_user_groups)'),
  }),
  output: z.object({
    users: z.array(z.string().describe('User ID')),
  }),
  handle: async params => {
    const data = await slackApi<{
      users: string[];
    }>('usergroups.users.list', {
      usergroup: params.usergroup,
    });

    return {
      users: data.users ?? [],
    };
  },
});
