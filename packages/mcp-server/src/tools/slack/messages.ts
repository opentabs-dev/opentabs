import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { SlackMessage } from './types.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * If the channel looks like a user ID (U...), open a DM first and return the DM channel ID.
 * Otherwise return the channel as-is.
 */
const resolveUserToDmChannel = async (channel: string): Promise<string> => {
  if (!/^U[A-Z0-9]+$/.test(channel)) {
    return channel;
  }

  const openResp = (await sendServiceRequest('slack', {
    method: 'conversations.open',
    params: {
      users: channel,
    },
  })) as { channel?: { id: string } };

  if (!openResp.channel?.id) {
    throw new Error(`Failed to open DM with user ${channel}`);
  }

  return openResp.channel.id;
};

export const registerMessageTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Send a message to a channel or DM
  define(
    'slack_send_message',
    {
      description:
        'Send a message to a Slack channel or direct message. Use slack_search_messages to find channel IDs from message permalinks, or slack_open_dm with a user ID to get a DM channel ID.',
      inputSchema: {
        channel: z
          .string()
          .describe('Channel ID (e.g., "C1234567890") - find via slack_search_messages permalinks or slack_open_dm'),
        text: z.string().describe('Message text to send'),
      },
    },
    async ({ channel, text }) => {
      // Auto-open DM if channel is a user ID
      const resolvedChannel = await resolveUserToDmChannel(channel);
      const result = await sendServiceRequest('slack', {
        method: 'chat.postMessage',
        params: { channel: resolvedChannel, text },
      });
      return success(result);
    },
  );

  // Read messages from a channel
  define(
    'slack_read_messages',
    {
      description:
        'Read recent messages from a Slack channel. Use slack_search_messages to find channel IDs from message permalinks.',
      inputSchema: {
        channel: z.string().describe('Channel ID (e.g., "C1234567890") - find via slack_search_messages permalinks'),
        limit: z.number().optional().default(10).describe('Number of messages to retrieve (default: 10, max: 100)'),
        oldest: z.string().optional().describe('Only messages after this timestamp'),
        latest: z.string().optional().describe('Only messages before this timestamp'),
      },
    },
    async ({ channel, limit, oldest, latest }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.history',
        params: {
          channel,
          limit: Math.min(limit ?? 10, 100),
          oldest,
          latest,
        },
      })) as { messages: SlackMessage[] };

      const messages = result.messages || [];
      const formatted = messages.map(msg => ({
        user: msg.user,
        text: msg.text,
        ts: msg.ts,
        thread_ts: msg.thread_ts,
        reactions: msg.reactions,
      }));

      return success(formatted);
    },
  );

  // Read thread replies
  define(
    'slack_read_thread',
    {
      description:
        'Read all replies in a Slack thread. Get channel ID and thread_ts from slack_search_messages results or slack_read_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the thread exists - find via slack_search_messages'),
        thread_ts: z
          .string()
          .describe('Timestamp of the parent message - get from message "ts" field or "thread_ts" in permalinks'),
        limit: z.number().optional().default(50).describe('Number of replies to retrieve (default: 50, max: 200)'),
      },
    },
    async ({ channel, thread_ts, limit }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'conversations.replies',
        params: {
          channel,
          ts: thread_ts,
          limit: Math.min(limit ?? 50, 200),
        },
      })) as { messages: SlackMessage[] };

      const messages = result.messages || [];
      const formatted = messages.map(msg => ({
        user: msg.user,
        text: msg.text,
        ts: msg.ts,
        thread_ts: msg.thread_ts,
        reactions: msg.reactions,
      }));

      return success(formatted);
    },
  );

  // Reply to a thread
  define(
    'slack_reply_to_thread',
    {
      description:
        'Reply to a message thread in Slack. Get channel ID and thread_ts from slack_read_messages or slack_search_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the thread exists - find via slack_search_messages'),
        thread_ts: z.string().describe('Timestamp of the parent message - get from message "ts" field'),
        text: z.string().describe('Reply text'),
      },
    },
    async ({ channel, thread_ts, text }) => {
      const result = await sendServiceRequest('slack', {
        method: 'chat.postMessage',
        params: {
          channel,
          text,
          thread_ts,
        },
      });
      return success(result);
    },
  );

  // Add reaction to a message
  define(
    'slack_react_to_message',
    {
      description:
        'Add an emoji reaction to a message. Get channel ID and timestamp from slack_read_messages or slack_search_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message exists - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message to react to - get from message "ts" field'),
        emoji: z.string().describe('Emoji name without colons (e.g., "thumbsup" not ":thumbsup:")'),
      },
    },
    async ({ channel, timestamp, emoji }) => {
      const result = await sendServiceRequest('slack', {
        method: 'reactions.add',
        params: {
          channel,
          timestamp,
          name: emoji,
        },
      });
      return success(result);
    },
  );

  // Update/edit an existing message
  define(
    'slack_update_message',
    {
      description:
        'Update/edit an existing message in a Slack channel. Get channel ID and timestamp from slack_read_messages or slack_search_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message exists - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message to update - get from message "ts" field'),
        text: z.string().describe('New text for the message'),
      },
    },
    async ({ channel, timestamp, text }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'chat.update',
        params: {
          channel,
          ts: timestamp,
          text,
        },
      })) as { ok: boolean; ts: string; text: string; channel: string };

      return success({
        ok: result.ok,
        channel: result.channel,
        ts: result.ts,
        text: result.text,
      });
    },
  );

  // Delete a message
  define(
    'slack_delete_message',
    {
      description:
        'Delete a message from a Slack channel. Get channel ID and timestamp from slack_read_messages or slack_search_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message exists - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message to delete - get from message "ts" field'),
      },
    },
    async ({ channel, timestamp }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'chat.delete',
        params: {
          channel,
          ts: timestamp,
        },
      })) as { ok: boolean; ts: string; channel: string };

      return success({
        ok: result.ok,
        channel: result.channel,
        ts: result.ts,
      });
    },
  );

  return tools;
};
