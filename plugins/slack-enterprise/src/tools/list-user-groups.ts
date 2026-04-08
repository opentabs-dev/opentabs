import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';
import { mapUserGroup, userGroupSchema } from './schemas.js';

export const listUserGroups = defineTool({
  name: 'list_user_groups',
  displayName: 'List User Groups',
  description:
    'List all user groups (handle groups) in the Slack workspace. User groups are @-mentionable teams like @engineering or @oncall-payments.',
  summary: 'List workspace user groups',
  icon: 'users',
  group: 'User Groups',
  input: z.object({
    include_disabled: z.boolean().optional().default(false).describe('Include disabled user groups (default false)'),
  }),
  output: z.object({
    user_groups: z.array(userGroupSchema),
  }),
  handle: async params => {
    const data = await slackApi<{
      usergroups: Array<Record<string, unknown>>;
    }>('usergroups.list', {
      include_disabled: params.include_disabled ?? false,
    });

    return {
      user_groups: (data.usergroups ?? []).map(mapUserGroup),
    };
  },
});
