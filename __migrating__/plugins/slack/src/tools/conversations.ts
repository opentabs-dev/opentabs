// =============================================================================
// Slack Plugin — Conversation Tools
//
// Tools for managing Slack conversations: opening DMs, creating/archiving
// channels, setting topics/purposes, inviting/kicking users, joining/leaving.
//
// Ported from packages/mcp-server/src/tools/slack/conversations.ts — adapted
// to use @opentabs/plugin-sdk/server instead of the monolith's internal utils.
// =============================================================================

import { createToolRegistrar, sendServiceRequest, success } from '@opentabs/plugin-sdk/server';
import { z } from 'zod';
import type { SlackChannel } from './types.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Get the workspace team_id needed for channel creation on enterprise workspaces.
 * Calls client.userBoot via the standard API to discover it.
 */
const getWorkspaceTeamId = async (): Promise<string | null> => {
  try {
    const data = (await sendServiceRequest('slack', { method: 'client.userBoot', params: {} })) as {
      ok?: boolean;
      default_workspace?: string;
      workspaces?: Array<{ id: string; name: string }>;
      channels?: Array<{ context_team_id: string }>;
    };

    if (data.ok === false) return null;

    return data.default_workspace || data.workspaces?.[0]?.id || data.channels?.[0]?.context_team_id || null;
  } catch {
    return null;
  }
};

export const registerConversationTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Open a DM with a user
  define(
    'slack_open_dm',
    {
      description:
        'Open a direct message conversation with a user. Returns a channel ID for sending DMs. Use slack_search_users or slack_list_users to find user IDs.',
      inputSchema: {
        user: z.string().describe('User ID to open DM with (e.g., "U1234567890") - find via slack_search_users'),
      },
    },
    async ({ user }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.open',
        params: {
          users: user,
        },
      })) as { channel: { id: string; is_im: boolean } };

      return success({
        channel_id: result.channel?.id,
        is_im: result.channel?.is_im,
      });
    },
  );

  // Create a new channel
  define(
    'slack_create_channel',
    {
      description: `Create a new Slack channel.

Returns the new channel's ID and name. Channel names must be lowercase, max 80 chars, using hyphens instead of spaces (e.g., "project-updates"). On enterprise workspaces, the workspace team_id is auto-detected.`,
      inputSchema: {
        name: z
          .string()
          .describe('Name of the channel (lowercase, no spaces, max 80 chars, use hyphens instead of spaces)'),
        is_private: z.boolean().optional().default(false).describe('Whether the channel should be private'),
      },
    },
    async ({ name, is_private }) => {
      const params: Record<string, unknown> = { name, is_private };

      // Enterprise workspaces require a workspace team_id for channel creation
      const workspaceTeamId = await getWorkspaceTeamId();
      if (workspaceTeamId) {
        params.team_id = workspaceTeamId;
        params.validate_name = 'true';
      }

      const result = (await sendServiceRequest('slack', { method: 'conversations.create', params })) as {
        channel: SlackChannel;
      };

      return success({
        id: result.channel?.id,
        name: result.channel?.name,
        is_private: result.channel?.is_private,
      });
    },
  );

  // Archive a channel
  define(
    'slack_archive_channel',
    {
      description:
        'Archive a Slack channel. Archived channels are hidden from the channel list but messages are preserved. Members can still search archived channel history.',
      inputSchema: {
        channel: z.string().describe('Channel ID to archive (e.g., "C1234567890")'),
      },
    },
    async ({ channel }) => {
      const result = await sendServiceRequest('slack', {
        method: 'conversations.archive',
        params: {
          channel,
        },
      });
      return success(result);
    },
  );

  // Unarchive a channel
  define(
    'slack_unarchive_channel',
    {
      description:
        'Unarchive a Slack channel, restoring it to the active channel list. All previous messages and members are preserved.',
      inputSchema: {
        channel: z.string().describe('Channel ID to unarchive (e.g., "C1234567890")'),
      },
    },
    async ({ channel }) => {
      const result = await sendServiceRequest('slack', {
        method: 'conversations.unarchive',
        params: {
          channel,
        },
      });
      return success(result);
    },
  );

  // Set channel topic
  define(
    'slack_set_channel_topic',
    {
      description:
        'Set the topic of a Slack channel. The topic appears in the channel header and is visible to all members. Max 250 characters.',
      inputSchema: {
        channel: z.string().describe('Channel ID (e.g., "C1234567890")'),
        topic: z.string().describe('New topic for the channel (max 250 chars)'),
      },
    },
    async ({ channel, topic }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.setTopic',
        params: {
          channel,
          topic,
        },
      })) as { topic: string };

      return success({
        channel,
        topic: result.topic,
      });
    },
  );

  // Set channel purpose
  define(
    'slack_set_channel_purpose',
    {
      description:
        'Set the purpose/description of a Slack channel. The purpose describes what the channel is used for and appears in channel details. Max 250 characters.',
      inputSchema: {
        channel: z.string().describe('Channel ID (e.g., "C1234567890")'),
        purpose: z.string().describe('New purpose for the channel (max 250 chars)'),
      },
    },
    async ({ channel, purpose }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.setPurpose',
        params: {
          channel,
          purpose,
        },
      })) as { purpose: string };

      return success({
        channel,
        purpose: result.purpose,
      });
    },
  );

  // Invite user(s) to a channel
  define(
    'slack_invite_to_channel',
    {
      description:
        'Invite one or more users to a Slack channel. Use slack_search_users to find user IDs, and slack_search_messages to find channel IDs.',
      inputSchema: {
        channel: z.string().describe('Channel ID to invite users to - find via slack_search_messages permalinks'),
        users: z.string().describe('Comma-separated list of user IDs - find via slack_search_users'),
      },
    },
    async ({ channel, users }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.invite',
        params: {
          channel,
          users,
        },
      })) as { channel: SlackChannel };

      return success({
        channel_id: result.channel?.id,
        channel_name: result.channel?.name,
      });
    },
  );

  // Remove a user from a channel
  define(
    'slack_kick_from_channel',
    {
      description:
        'Remove a user from a Slack channel. Use slack_search_users to find user IDs, and slack_list_channel_members to see current members.',
      inputSchema: {
        channel: z.string().describe('Channel ID to remove user from - find via slack_search_messages permalinks'),
        user: z.string().describe('User ID to remove - find via slack_search_users or slack_list_channel_members'),
      },
    },
    async ({ channel, user }) => {
      const result = await sendServiceRequest('slack', {
        method: 'conversations.kick',
        params: {
          channel,
          user,
        },
      });
      return success(result);
    },
  );

  // Rename a channel
  define(
    'slack_rename_channel',
    {
      description:
        'Rename a Slack channel. Returns the updated channel ID and new name. Names must be lowercase, max 80 chars, using hyphens instead of spaces.',
      inputSchema: {
        channel: z.string().describe('Channel ID to rename (e.g., "C1234567890")'),
        name: z
          .string()
          .describe('New name for the channel (lowercase, no spaces, max 80 chars, use hyphens instead of spaces)'),
      },
    },
    async ({ channel, name }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.rename',
        params: {
          channel,
          name,
        },
      })) as { channel: SlackChannel };

      return success({
        id: result.channel?.id,
        name: result.channel?.name,
      });
    },
  );

  // Join a channel
  define(
    'slack_join_channel',
    {
      description:
        'Join a public Slack channel. Only works for public channels — private channels require an invitation via slack_invite_to_channel. Returns the channel ID and name.',
      inputSchema: {
        channel: z.string().describe('Channel ID to join (e.g., "C1234567890")'),
      },
    },
    async ({ channel }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.join',
        params: {
          channel,
        },
      })) as { channel: SlackChannel };

      return success({
        id: result.channel?.id,
        name: result.channel?.name,
        is_member: true,
      });
    },
  );

  // Leave a channel
  define(
    'slack_leave_channel',
    {
      description:
        'Leave a Slack channel. You will stop receiving notifications and the channel will be removed from your sidebar.',
      inputSchema: {
        channel: z.string().describe('Channel ID to leave (e.g., "C1234567890")'),
      },
    },
    async ({ channel }) => {
      const result = await sendServiceRequest('slack', {
        method: 'conversations.leave',
        params: {
          channel,
        },
      });
      return success(result);
    },
  );

  return tools;
};
