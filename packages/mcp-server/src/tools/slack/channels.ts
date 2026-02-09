import { success, sendServiceRequest, sendSlackEdgeRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { SlackChannel, SlackUser } from './types.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerChannelTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Get channel info
  define(
    'slack_get_channel_info',
    {
      description:
        'Get detailed information about a Slack channel including topic, purpose, and member count. Find channel IDs from slack_search_messages permalinks (e.g., /archives/C1234567890/).',
      inputSchema: {
        channel: z.string().describe('Channel ID (e.g., "C1234567890") - extract from message permalinks'),
      },
    },
    async ({ channel }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.info',
        params: {
          channel,
        },
      })) as { channel: SlackChannel };

      const ch = result.channel;
      const formatted = {
        id: ch.id,
        name: ch.name,
        is_channel: ch.is_channel,
        is_group: ch.is_group,
        is_private: ch.is_private,
        is_archived: ch.is_archived,
        is_member: ch.is_member,
        num_members: ch.num_members,
        topic: ch.topic?.value,
        purpose: ch.purpose?.value,
      };

      return success(formatted);
    },
  );

  // List channel members
  define(
    'slack_list_channel_members',
    {
      description:
        'List members of a Slack channel with their user IDs and names. Find channel IDs from slack_search_messages permalinks.',
      inputSchema: {
        channel: z.string().describe('Channel ID (e.g., "C1234567890") - extract from message permalinks'),
        limit: z.number().optional().default(100).describe('Maximum number of members to return'),
      },
    },
    async ({ channel, limit }) => {
      // Try Edge API users/list with channel filter (works on enterprise workspaces)
      const edgeResult = (await sendSlackEdgeRequest('users/list', {
        channels: [channel],
        present_first: true,
        filter: 'everyone',
        count: limit || 100,
      })) as {
        ok?: boolean;
        results?: Array<{
          id: string;
          name: string;
          real_name?: string;
          deleted?: boolean;
          is_bot?: boolean;
          is_admin?: boolean;
          profile?: { display_name?: string; real_name?: string; email?: string };
        }>;
        next_cursor?: string;
      };

      if (edgeResult.ok !== false && edgeResult.results && edgeResult.results.length > 0) {
        return success({
          channel,
          member_count: edgeResult.results.length,
          members: edgeResult.results.map(user => ({
            id: user.id,
            name: user.name,
            real_name: user.real_name || user.profile?.real_name,
            display_name: user.profile?.display_name,
            is_bot: user.is_bot || false,
            is_admin: user.is_admin || false,
          })),
        });
      }

      // Fallback: standard API for non-enterprise workspaces
      const membersResult = (await sendServiceRequest('slack', {
        method: 'conversations.members',
        params: {
          channel,
          limit,
        },
      })) as { members: string[] };

      const memberIds = membersResult.members || [];

      // Get user info for each member
      const usersResult = (await sendServiceRequest('slack', { method: 'users.list', params: {} })) as {
        members: SlackUser[];
      };
      const allUsers = usersResult.members || [];

      const members = memberIds
        .map(id => allUsers.find(u => u.id === id))
        .filter((u): u is SlackUser => u !== undefined)
        .map(user => ({
          id: user.id,
          name: user.name,
          real_name: user.real_name || user.profile?.real_name,
          display_name: user.profile?.display_name,
          is_bot: user.is_bot,
          is_admin: user.is_admin,
        }));

      return success({
        channel,
        member_count: memberIds.length,
        members,
      });
    },
  );

  // List channels
  define(
    'slack_list_channels',
    {
      description: `List channels in the Slack workspace.

Returns for each channel:
- Channel ID, name, and privacy status (is_private)
- Archived status
- Topic and purpose text

Supports filtering by type (public, private, DM, group DM) and pagination via cursor. Use channel IDs from results with slack_read_messages, slack_get_channel_info, or other channel tools.`,
      inputSchema: {
        types: z
          .string()
          .optional()
          .default('public_channel,private_channel')
          .describe('Comma-separated channel types: public_channel, private_channel, mpim, im'),
        limit: z
          .number()
          .optional()
          .default(100)
          .describe('Maximum number of channels to return (default: 100, max: 1000)'),
        exclude_archived: z.boolean().optional().default(true).describe('Exclude archived channels'),
        cursor: z.string().optional().describe('Pagination cursor for next page'),
      },
    },
    async ({ types, limit, exclude_archived, cursor }) => {
      const effectiveLimit = Math.min(limit ?? 100, 1000);

      // Try Edge API channels/list (works on enterprise workspaces)
      const edgeResult = (await sendSlackEdgeRequest('channels/list', {
        types: types || 'public_channel,private_channel',
        count: effectiveLimit,
        exclude_archived: exclude_archived !== false,
      })) as {
        ok?: boolean;
        results?: Array<{
          id: string;
          name: string;
          is_private?: boolean;
          is_archived?: boolean;
          is_member?: boolean;
          num_members?: number;
          topic?: { value: string };
          purpose?: { value: string };
        }>;
        next_cursor?: string;
      };

      if (edgeResult.ok !== false && edgeResult.results) {
        const channels = edgeResult.results;
        const formatted = channels.map(ch => ({
          id: ch.id,
          name: ch.name,
          is_private: ch.is_private || false,
          is_archived: ch.is_archived || false,
          is_member: ch.is_member,
          num_members: ch.num_members,
          topic: ch.topic?.value,
          purpose: ch.purpose?.value,
        }));

        return success({
          count: channels.length,
          channels: formatted,
          next_cursor: edgeResult.next_cursor || null,
        });
      }

      // Fallback: standard API for non-enterprise workspaces
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.list',
        params: {
          types,
          limit: effectiveLimit,
          exclude_archived,
          cursor,
        },
      })) as { channels: SlackChannel[]; response_metadata?: { next_cursor?: string } };

      const channels = result.channels || [];
      const formatted = channels.map(ch => ({
        id: ch.id,
        name: ch.name,
        is_private: ch.is_private,
        is_archived: ch.is_archived,
        is_member: ch.is_member,
        num_members: ch.num_members,
        topic: ch.topic?.value,
        purpose: ch.purpose?.value,
      }));

      return success({
        count: channels.length,
        channels: formatted,
        next_cursor: result.response_metadata?.next_cursor || null,
      });
    },
  );

  return tools;
};
