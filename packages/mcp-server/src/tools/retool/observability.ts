import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerRetoolObservabilityTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Check if observability is enabled
  defineTool(
    tools,
    server,
    'retool_check_observability',
    {
      description:
        'Check whether error tracking and performance monitoring are enabled for the Retool organization. Returns boolean flags: errorMonitoringEnabled and performanceMonitoringEnabled.',
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/appObservability/checkEnabled',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Get app errors
  defineTool(
    tools,
    server,
    'retool_get_app_errors',
    {
      description:
        'Get application errors tracked by Retool observability. Returns error events with details. Requires error monitoring to be enabled (check with retool_check_observability first).',
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/appObservability/errors',
        method: 'POST',
        body: {},
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
