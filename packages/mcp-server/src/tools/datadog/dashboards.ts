import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogDashboardsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List dashboards
  define(
    'datadog_list_dashboards',
    {
      description: `List all dashboards in the Datadog organization.

Returns for each dashboard:
- Dashboard ID (needed by datadog_get_dashboard), title, and description
- Author handle and creation/modification timestamps
- Layout type (ordered or free) and URL

Use datadog_search_dashboards to filter by name, or datadog_get_dashboard with a specific ID to get the full widget definitions.`,
      inputSchema: {
        filterShared: z.boolean().optional().describe('Filter to only shared dashboards'),
        filterDeleted: z.boolean().optional().describe('Include deleted dashboards'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ filterShared, filterDeleted, env }) => {
      const params: Record<string, string> = {};
      if (filterShared !== undefined) params.filter_shared = String(filterShared);
      if (filterDeleted !== undefined) params.filter_deleted = String(filterDeleted);

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/dashboard',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Get dashboard by ID
  define(
    'datadog_get_dashboard',
    {
      description: `Get the full definition of a specific Datadog dashboard by its ID.

Returns:
- Dashboard title, description, and layout type
- Complete widget list with query definitions, visualization types, and conditional formatting
- Template variables and their defaults
- Reflow type and notification list

Use this to understand what metrics and queries a dashboard monitors. Dashboard IDs can be found from datadog_list_dashboards or datadog_search_dashboards.`,
      inputSchema: {
        dashboardId: z.string().describe('The dashboard ID (alphanumeric string)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ dashboardId, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/dashboard/${dashboardId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Search dashboards
  define(
    'datadog_search_dashboards',
    {
      description: `Search dashboards by title or description. Performs client-side filtering against all dashboards.

Returns matching dashboards with their IDs, titles, descriptions, and author info. Use the dashboard ID with datadog_get_dashboard to get the full widget definitions.`,
      inputSchema: {
        query: z.string().describe('Search query for dashboard title'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, env }) => {
      // List all dashboards and filter client-side since there's no search API
      const result = (await sendServiceRequest('datadog', {
        endpoint: '/api/v1/dashboard',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      })) as {
        dashboards?: Array<{ id: string; title: string; description?: string; [key: string]: unknown }>;
      };

      const queryLower = query.toLowerCase();
      const filtered = result.dashboards?.filter(
        d => d.title?.toLowerCase().includes(queryLower) || d.description?.toLowerCase().includes(queryLower) || false,
      );

      return success({ dashboards: filtered || [] });
    },
  );

  return tools;
};
