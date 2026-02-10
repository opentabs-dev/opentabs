// =============================================================================
// Slack Plugin — User Tools
//
// Tools for looking up Slack users, listing workspace members, and getting
// the current user's profile.
// =============================================================================

import { createToolRegistrar, sendServiceRequest, success } from '@opentabs/plugin-sdk/server';
import { z } from 'zod';
import type { SlackUser } from './types.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerUserTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Get user info
  define(
    'slack_get_user_info',
    {
      description:
        'Get information about a Slack user including name, email, and admin status. Use slack_search_users to find user IDs by name.',
      inputSchema: {
        user: z.string().describe('User ID (e.g., "U1234567890") - find via slack_search_users'),
      },
    },
    async ({ user }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'users.info',
        params: {
          user,
        },
      })) as { user: SlackUser };

      const u = result.user;
      const formatted = {
        id: u.id,
        name: u.name,
        real_name: u.real_name || u.profile?.real_name,
        display_name: u.profile?.display_name,
        email: u.profile?.email,
        is_bot: u.is_bot,
        is_admin: u.is_admin,
      };

      return success(formatted);
    },
  );

  // List users
  define(
    'slack_list_users',
    {
      description:
        'List users in the Slack workspace with their IDs. Use this to discover user IDs for other operations, or use slack_search_users to search by name.',
      inputSchema: {
        limit: z.number().optional().default(100).describe('Maximum number of users to return'),
        include_bots: z.boolean().optional().default(false).describe('Include bot users'),
      },
    },
    async ({ limit, include_bots }) => {
      const result = (await sendServiceRequest('slack', { method: 'users.list', params: {} })) as {
        members: SlackUser[];
      };

      let users = result.members || [];

      if (!include_bots) {
        users = users.filter(u => !u.is_bot);
      }

      const formatted = users.slice(0, limit).map(user => ({
        id: user.id,
        name: user.name,
        real_name: user.real_name || user.profile?.real_name,
        display_name: user.profile?.display_name,
        email: user.profile?.email,
        is_bot: user.is_bot,
        is_admin: user.is_admin,
      }));

      return success(formatted);
    },
  );

  // Get current user's profile
  define(
    'slack_get_my_profile',
    {
      description: `Get the current authenticated user's profile.

Returns:
- User ID and username
- Team name and team ID
- Real name, display name, and email
- Admin status

Use this to identify yourself when constructing messages or to get your own user ID for other operations.`,
    },
    async () => {
      const result = (await sendServiceRequest('slack', { method: 'auth.test', params: {} })) as {
        user_id: string;
        user: string;
        team: string;
        team_id: string;
      };

      // Get detailed user info
      const userResult = (await sendServiceRequest('slack', {
        method: 'users.info',
        params: {
          user: result.user_id,
        },
      })) as { user: SlackUser };

      const u = userResult.user;
      const formatted = {
        user_id: result.user_id,
        username: result.user,
        team: result.team,
        team_id: result.team_id,
        real_name: u.real_name || u.profile?.real_name,
        display_name: u.profile?.display_name,
        email: u.profile?.email,
        is_admin: u.is_admin,
      };

      return success(formatted);
    },
  );

  return tools;
};
