import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

interface StarredItem {
  type: string;
  channel?: string;
  message?: {
    ts: string;
    text: string;
    user: string;
    permalink?: string;
  };
  file?: {
    id: string;
    name: string;
    permalink?: string;
  };
  date_create?: number;
}

// saved.list response item (modern replacement for stars.list)
interface SavedItem {
  item_id: string;
  item_type: string; // 'file', 'message', etc.
  date_created: number;
  date_due: number;
  date_completed: number;
  date_updated: number;
  is_archived: boolean;
  date_snoozed_until: number;
  state: string; // 'in_progress', 'completed', etc.
}

export const registerStarTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Star a message
  defineTool(
    tools,
    server,
    'slack_star_message',
    {
      description:
        'Add a star to a message for quick access later. Get channel ID and timestamp from slack_read_messages or slack_search_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message exists - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message to star - get from message "ts" field'),
      },
    },
    async ({ channel, timestamp }) => {
      const result = await sendServiceRequest('slack', {
        method: 'stars.add',
        params: {
          channel,
          timestamp,
        },
      });
      return success(result);
    },
  );

  // Star a file
  defineTool(
    tools,
    server,
    'slack_star_file',
    {
      description:
        'Add a star to a file for quick access later. Find file IDs via slack_search_files or slack_list_files.',
      inputSchema: {
        file: z.string().describe('File ID to star (e.g., "F1234567890") - find via slack_search_files'),
      },
    },
    async ({ file }) => {
      const result = await sendServiceRequest('slack', {
        method: 'stars.add',
        params: {
          file,
        },
      });
      return success(result);
    },
  );

  // Remove star from a message
  defineTool(
    tools,
    server,
    'slack_unstar_message',
    {
      description:
        'Remove a star from a message. Get channel ID and timestamp from slack_read_messages or slack_search_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message exists - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message to unstar - get from message "ts" field'),
      },
    },
    async ({ channel, timestamp }) => {
      const result = await sendServiceRequest('slack', {
        method: 'stars.remove',
        params: {
          channel,
          timestamp,
        },
      });
      return success(result);
    },
  );

  // Remove star from a file
  defineTool(
    tools,
    server,
    'slack_unstar_file',
    {
      description: 'Remove a star from a file. Find file IDs via slack_search_files or slack_list_files.',
      inputSchema: {
        file: z.string().describe('File ID to unstar (e.g., "F1234567890") - find via slack_search_files'),
      },
    },
    async ({ file }) => {
      const result = await sendServiceRequest('slack', {
        method: 'stars.remove',
        params: {
          file,
        },
      });
      return success(result);
    },
  );

  // List starred/saved items
  // Note: stars.list is enterprise-restricted, so we use saved.list (the modern replacement)
  defineTool(
    tools,
    server,
    'slack_list_stars',
    {
      description: `List all starred/saved items for the authenticated user.

Returns for each item:
- Item type (message or file)
- Creation date and state (in_progress, completed)
- For messages: text, author, timestamp, and permalink
- For files: file ID, name, and permalink

Uses the modern saved.list API on enterprise workspaces, with stars.list as fallback. Supports pagination via cursor.`,
      inputSchema: {
        count: z
          .number()
          .optional()
          .default(50)
          .describe('Number of items to return (default: 50, max: 50 for saved.list, max: 1000 for stars.list)'),
        cursor: z.string().optional().describe('Pagination cursor for next page'),
      },
    },
    async ({ count, cursor }) => {
      // Try saved.list first (modern API that works on enterprise)
      // Note: saved.list has a max limit of 50
      const savedResult = (await sendServiceRequest('slack', {
        method: 'saved.list',
        params: {
          limit: Math.min(count ?? 50, 50),
          cursor,
        },
      })) as {
        saved_items?: SavedItem[];
        counts?: { total_count: number };
        response_metadata?: { next_cursor?: string };
        ok?: boolean;
        error?: string;
      };

      if (savedResult.ok !== false && savedResult.saved_items) {
        // Format saved.list response
        const items = savedResult.saved_items || [];
        const formatted = items.map(item => ({
          type: item.item_type,
          item_id: item.item_id,
          date_created: item.date_created,
          state: item.state,
          is_archived: item.is_archived,
          date_due: item.date_due || null,
          date_completed: item.date_completed || null,
        }));

        return success({
          count: items.length,
          total_count: savedResult.counts?.total_count,
          items: formatted,
          next_cursor: savedResult.response_metadata?.next_cursor || null,
        });
      }

      // Fall back to stars.list for non-enterprise workspaces
      const result = (await sendServiceRequest('slack', {
        method: 'stars.list',
        params: {
          count: Math.min(count ?? 100, 1000),
          cursor,
        },
      })) as { items: StarredItem[]; response_metadata?: { next_cursor?: string } };

      const items = result.items || [];
      const formatted = items.map(item => ({
        type: item.type,
        date_create: item.date_create,
        channel: item.channel,
        message: item.message
          ? {
              ts: item.message.ts,
              text: item.message.text,
              user: item.message.user,
              permalink: item.message.permalink,
            }
          : undefined,
        file: item.file
          ? {
              id: item.file.id,
              name: item.file.name,
              permalink: item.file.permalink,
            }
          : undefined,
      }));

      return success({
        count: items.length,
        items: formatted,
        next_cursor: result.response_metadata?.next_cursor || null,
      });
    },
  );

  return tools;
};
