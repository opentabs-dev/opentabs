// =============================================================================
// Slack Plugin — Search Tools
//
// Tools for searching messages and files in Slack workspaces.
//
// Extracted from the original monolith at:
//   packages/mcp-server/src/tools/slack/search.ts
//
// Now uses @opentabs/plugin-sdk/server for all platform interactions instead
// of importing directly from the MCP server's internal modules.
// =============================================================================

import {
  createToolRegistrar,
  sendServiceRequest,
  success,
} from '@opentabs/plugin-sdk/server';

import { z } from 'zod';

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlackSearchResponse } from './types.js';

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export const registerSearchTools = (
  server: McpServer,
): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // -------------------------------------------------------------------------
  // Search messages
  // -------------------------------------------------------------------------

  define(
    'slack_search_messages',
    {
      description:
        'Search for messages across a Slack workspace. Returns matching messages with ' +
        'channel info, timestamps, and permalinks. Supports Slack search modifiers like ' +
        '"from:@user", "in:#channel", "has:link", "before:2024-01-01", "after:2024-01-01", ' +
        '"during:January". This is the best starting tool when you need to find a conversation, ' +
        'channel ID, or message timestamp.',
      inputSchema: {
        query: z
          .string()
          .describe(
            'Slack search query. Supports text and modifiers: ' +
            '"from:@user", "in:#channel", "has:link", "has:reaction", ' +
            '"before:YYYY-MM-DD", "after:YYYY-MM-DD", "during:month"',
          ),
        count: z
          .number()
          .optional()
          .default(20)
          .describe('Number of results to return (default: 20, max: 100)'),
        sort: z
          .enum(['score', 'timestamp'])
          .optional()
          .default('score')
          .describe('Sort order: "score" (relevance) or "timestamp" (newest first)'),
        sort_dir: z
          .enum(['asc', 'desc'])
          .optional()
          .default('desc')
          .describe('Sort direction: "asc" or "desc" (default: "desc")'),
        page: z
          .number()
          .optional()
          .default(1)
          .describe('Page number for pagination (default: 1)'),
      },
    },
    async ({ query, count, sort, sort_dir, page }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'search.messages',
        params: {
          query,
          count: Math.min(count ?? 20, 100),
          sort: sort ?? 'score',
          sort_dir: sort_dir ?? 'desc',
          page: page ?? 1,
        },
      })) as SlackSearchResponse;

      if (!result.messages) {
        return success({ matches: [], total: 0, page: 1, pages: 0 });
      }

      const matches = result.messages.matches.map(match => ({
        text: match.text,
        ts: match.ts,
        username: match.username,
        user: match.user,
        channel: {
          id: match.channel.id,
          name: match.channel.name,
        },
        permalink: match.permalink,
      }));

      return success({
        matches,
        total: result.messages.total,
        page: result.messages.paging.page,
        pages: result.messages.paging.pages,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Search files
  // -------------------------------------------------------------------------

  define(
    'slack_search_files',
    {
      description:
        'Search for files shared in a Slack workspace. Returns matching files with ' +
        'metadata, download links, and the channels they were shared in. Supports ' +
        'Slack search modifiers like "from:@user", "in:#channel", "type:pdf", ' +
        '"before:2024-01-01", "after:2024-01-01".',
      inputSchema: {
        query: z
          .string()
          .describe(
            'Slack search query for files. Supports text and modifiers: ' +
            '"from:@user", "in:#channel", "type:filetype", ' +
            '"before:YYYY-MM-DD", "after:YYYY-MM-DD"',
          ),
        count: z
          .number()
          .optional()
          .default(20)
          .describe('Number of results to return (default: 20, max: 100)'),
        sort: z
          .enum(['score', 'timestamp'])
          .optional()
          .default('score')
          .describe('Sort order: "score" (relevance) or "timestamp" (newest first)'),
        sort_dir: z
          .enum(['asc', 'desc'])
          .optional()
          .default('desc')
          .describe('Sort direction: "asc" or "desc" (default: "desc")'),
        page: z
          .number()
          .optional()
          .default(1)
          .describe('Page number for pagination (default: 1)'),
      },
    },
    async ({ query, count, sort, sort_dir, page }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'search.files',
        params: {
          query,
          count: Math.min(count ?? 20, 100),
          sort: sort ?? 'score',
          sort_dir: sort_dir ?? 'desc',
          page: page ?? 1,
        },
      })) as {
        ok: boolean;
        files?: {
          matches: readonly {
            id: string;
            name: string;
            title?: string;
            filetype?: string;
            mimetype?: string;
            size?: number;
            user?: string;
            created?: number;
            permalink?: string;
            url_private?: string;
            channels?: readonly string[];
          }[];
          paging: {
            count: number;
            total: number;
            page: number;
            pages: number;
          };
          total: number;
        };
      };

      if (!result.files) {
        return success({ matches: [], total: 0, page: 1, pages: 0 });
      }

      const matches = result.files.matches.map(file => ({
        id: file.id,
        name: file.name,
        title: file.title,
        filetype: file.filetype,
        mimetype: file.mimetype,
        size: file.size,
        user: file.user,
        created: file.created,
        permalink: file.permalink,
        url_private: file.url_private,
        channels: file.channels,
      }));

      return success({
        matches,
        total: result.files.total,
        page: result.files.paging.page,
        pages: result.files.paging.pages,
      });
    },
  );

  return tools;
};
