import { success, sendServiceRequest, sendSlackEdgeRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { SlackSearchResult, SlackUser } from './types.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerSearchTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Search messages
  define(
    'slack_search_messages',
    {
      description: `Search for messages in Slack.

Returns for each match:
- Channel name and message text
- Author username and timestamp
- Permalink (contains channel ID in /archives/C1234567890/ — extract this for use with other channel tools)

Supports sorting by relevance score or timestamp. Use this to find channel IDs, locate discussions about a topic, or find messages from a specific user.`,
      inputSchema: {
        query: z.string().describe('Search query string'),
        count: z.number().optional().default(20).describe('Number of results to return (default: 20, max: 100)'),
        sort: z.enum(['score', 'timestamp']).optional().default('score').describe('Sort order'),
        sort_dir: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction'),
      },
    },
    async ({ query, count, sort, sort_dir }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'search.messages',
        params: {
          query,
          count: Math.min(count ?? 20, 100),
          sort,
          sort_dir,
        },
      })) as SlackSearchResult;

      const messages = result.messages?.matches || [];
      const formatted = messages.map(msg => ({
        channel: msg.channel.name,
        user: msg.username,
        text: msg.text,
        ts: msg.ts,
        permalink: msg.permalink,
      }));

      return success({
        total: result.messages?.total || 0,
        messages: formatted,
      });
    },
  );

  // Search files
  define(
    'slack_search_files',
    {
      description: `Search for files in Slack.

Returns for each match:
- File ID, name, title, and type (pdf, image, snippet, etc.)
- File size and permalink

Use file IDs from results with slack_get_file_info for full details, or slack_star_file to bookmark.`,
      inputSchema: {
        query: z.string().describe('Search query string'),
        count: z.number().optional().default(20).describe('Number of results to return (default: 20, max: 100)'),
      },
    },
    async ({ query, count }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'search.files',
        params: {
          query,
          count: Math.min(count ?? 20, 100),
        },
      })) as SlackSearchResult;

      const files = result.files?.matches || [];
      const formatted = files.map(file => ({
        id: file.id,
        name: file.name,
        title: file.title,
        filetype: file.filetype,
        size: file.size,
        permalink: file.permalink,
      }));

      return success({
        total: result.files?.total || 0,
        files: formatted,
      });
    },
  );

  // Search users
  define(
    'slack_search_users',
    {
      description: `Search for users in the Slack workspace by name or email.

Returns for each match:
- User ID (needed by most other Slack tools), username, and real name
- Display name and email address
- Bot status

This is the primary way to find user IDs. Use the returned user IDs with slack_open_dm, slack_get_user_info, slack_invite_to_channel, etc.`,
      inputSchema: {
        query: z.string().describe('Search query (name or email)'),
      },
    },
    async ({ query }) => {
      // Try Edge API users/search (works on enterprise workspaces)
      const searchResult = (await sendSlackEdgeRequest('users/search', {
        query,
        count: 20,
      })) as { results?: SlackUser[]; ok?: boolean; error?: string };

      if (searchResult.ok !== false && searchResult.results && searchResult.results.length > 0) {
        const formatted = searchResult.results.slice(0, 20).map(user => ({
          id: user.id,
          name: user.name,
          real_name: user.real_name || user.profile?.real_name,
          display_name: user.profile?.display_name,
          email: user.profile?.email,
          is_bot: user.is_bot,
        }));
        return success(formatted);
      }

      // Fall back to listing users and filtering (for non-enterprise workspaces)
      const result = (await sendServiceRequest('slack', { method: 'users.list', params: {} })) as {
        members: SlackUser[];
      };

      const users = (result.members || []).filter(user => {
        const searchLower = query.toLowerCase();
        return (
          user.name?.toLowerCase().includes(searchLower) ||
          user.real_name?.toLowerCase().includes(searchLower) ||
          user.profile?.display_name?.toLowerCase().includes(searchLower) ||
          user.profile?.email?.toLowerCase().includes(searchLower)
        );
      });

      const formatted = users.slice(0, 20).map(user => ({
        id: user.id,
        name: user.name,
        real_name: user.real_name || user.profile?.real_name,
        display_name: user.profile?.display_name,
        email: user.profile?.email,
        is_bot: user.is_bot,
      }));

      return success(formatted);
    },
  );

  return tools;
};
