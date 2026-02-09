import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

interface PinnedItem {
  type: string;
  channel?: string;
  message?: {
    ts: string;
    text: string;
    user: string;
  };
  file?: {
    id: string;
    name: string;
  };
  created?: number;
  created_by?: string;
}

export const registerPinTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Pin a message to a channel
  define(
    'slack_pin_message',
    {
      description:
        'Pin a message to a Slack channel. Get channel ID and timestamp from slack_read_messages or slack_search_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message exists - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message to pin - get from message "ts" field'),
      },
    },
    async ({ channel, timestamp }) => {
      const result = await sendServiceRequest('slack', {
        method: 'pins.add',
        params: {
          channel,
          timestamp,
        },
      });
      return success(result);
    },
  );

  // Unpin a message from a channel
  define(
    'slack_unpin_message',
    {
      description:
        'Remove a pinned message from a Slack channel. Use slack_list_pins to see currently pinned items and their timestamps.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message is pinned - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message to unpin - get from slack_list_pins'),
      },
    },
    async ({ channel, timestamp }) => {
      const result = await sendServiceRequest('slack', {
        method: 'pins.remove',
        params: {
          channel,
          timestamp,
        },
      });
      return success(result);
    },
  );

  // List pinned items in a channel
  define(
    'slack_list_pins',
    {
      description:
        'List all pinned items in a Slack channel including messages and files. Find channel IDs from slack_search_messages permalinks.',
      inputSchema: {
        channel: z.string().describe('Channel ID to list pins from - extract from message permalinks'),
      },
    },
    async ({ channel }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'pins.list',
        params: {
          channel,
        },
      })) as { items: PinnedItem[] };

      const items = result.items || [];
      const formatted = items.map(item => ({
        type: item.type,
        created: item.created,
        created_by: item.created_by,
        message: item.message
          ? {
              ts: item.message.ts,
              text: item.message.text,
              user: item.message.user,
            }
          : undefined,
        file: item.file
          ? {
              id: item.file.id,
              name: item.file.name,
            }
          : undefined,
      }));

      return success({
        channel,
        count: items.length,
        items: formatted,
      });
    },
  );

  return tools;
};
