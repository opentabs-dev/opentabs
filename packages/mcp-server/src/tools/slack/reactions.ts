import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

interface ReactionItem {
  name: string;
  count: number;
  users: string[];
}

interface MessageWithReactions {
  type: string;
  channel: string;
  message: {
    ts: string;
    text: string;
    user: string;
    reactions?: ReactionItem[];
  };
}

export const registerReactionTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Remove a reaction from a message
  defineTool(
    tools,
    server,
    'slack_remove_reaction',
    {
      description:
        'Remove an emoji reaction from a message. Get channel ID and timestamp from slack_read_messages or slack_search_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message exists - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message - get from message "ts" field'),
        emoji: z.string().describe('Emoji name without colons (e.g., "thumbsup" not ":thumbsup:")'),
      },
    },
    async ({ channel, timestamp, emoji }) => {
      const result = await sendServiceRequest('slack', {
        method: 'reactions.remove',
        params: {
          channel,
          timestamp,
          name: emoji,
        },
      });
      return success(result);
    },
  );

  // Get reactions for a message
  defineTool(
    tools,
    server,
    'slack_get_reactions',
    {
      description:
        'Get all reactions on a message with emoji names and user lists. Get channel ID and timestamp from slack_read_messages.',
      inputSchema: {
        channel: z.string().describe('Channel ID where the message exists - find via slack_search_messages'),
        timestamp: z.string().describe('Timestamp of the message - get from message "ts" field'),
        full: z.boolean().optional().default(false).describe('If true, return complete user list for each reaction'),
      },
    },
    async ({ channel, timestamp, full }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'reactions.get',
        params: {
          channel,
          timestamp,
          full,
        },
      })) as MessageWithReactions;

      const reactions = result.message?.reactions || [];
      const formatted = reactions.map(reaction => ({
        emoji: reaction.name,
        count: reaction.count,
        users: reaction.users,
      }));

      return success({
        channel,
        timestamp,
        reactions: formatted,
        total_reactions: reactions.reduce((sum, r) => sum + r.count, 0),
      });
    },
  );

  return tools;
};
