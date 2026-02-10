// =============================================================================
// Slack Plugin — File Tools
//
// Tools for listing and inspecting files shared in Slack.
//
// Ported from packages/mcp-server/src/tools/slack/files.ts — adapted to use
// @opentabs/plugin-sdk/server instead of the monolith's internal utils module.
// =============================================================================

import { createToolRegistrar, sendServiceRequest, success } from '@opentabs/plugin-sdk/server';
import { z } from 'zod';
import type { SlackFile } from './types.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerFileTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Get file info
  define(
    'slack_get_file_info',
    {
      description:
        'Get detailed information about a file in Slack including download URLs. Find file IDs via slack_search_files or slack_list_files.',
      inputSchema: {
        file: z.string().describe('File ID (e.g., "F1234567890") - find via slack_search_files or slack_list_files'),
      },
    },
    async ({ file }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'files.info',
        params: {
          file,
        },
      })) as { file: SlackFile };

      const f = result.file;
      const formatted = {
        id: f.id,
        name: f.name,
        title: f.title,
        mimetype: f.mimetype,
        filetype: f.filetype,
        size: f.size,
        url_private: f.url_private,
        permalink: f.permalink,
      };

      return success(formatted);
    },
  );

  // List files
  define(
    'slack_list_files',
    {
      description:
        'List files in the Slack workspace. Returns file IDs that can be used with slack_get_file_info, slack_star_file, etc.',
      inputSchema: {
        channel: z.string().optional().describe('Filter by channel ID - find via slack_search_messages'),
        user: z.string().optional().describe('Filter by user ID - find via slack_search_users'),
        types: z.string().optional().describe('Filter by file types (e.g., "images", "pdfs")'),
        count: z.number().optional().default(20).describe('Number of files to return'),
      },
    },
    async ({ channel, user, types, count }) => {
      const result = (await sendServiceRequest('slack', {
        method: 'files.list',
        params: {
          channel,
          user,
          types,
          count,
        },
      })) as { files: SlackFile[] };

      const files = result.files || [];
      const formatted = files.map(file => ({
        id: file.id,
        name: file.name,
        title: file.title,
        filetype: file.filetype,
        size: file.size,
        permalink: file.permalink,
      }));

      return success(formatted);
    },
  );

  return tools;
};
