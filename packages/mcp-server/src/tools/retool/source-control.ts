import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerRetoolSourceControlTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List commits on a branch
  defineTool(
    tools,
    server,
    'retool_list_commits',
    {
      description:
        'List commits on a specific source control branch in Retool. Returns commit history and latest element save IDs. Use branch names from retool_list_branches.',
      inputSchema: {
        branchName: z.string().describe('The branch name (e.g., "bromero/patch-be56")'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ branchName, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/branches/getCommitsOnBranch`,
        method: 'GET',
        params: { branchName },
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
