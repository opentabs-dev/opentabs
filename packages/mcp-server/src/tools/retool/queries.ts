import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerRetoolQueryTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List playground queries
  define(
    'retool_list_queries',
    {
      description: `List saved queries in the Retool Query Playground.

Returns: orgQueryCount, orgQueries[] (id, name, uuid, editorName, resourceId, resourceUuid, shared, updatedAt), userQueries[].
Use query IDs from results with retool_get_query to see full SQL/code, or retool_get_query_usages to find where a query is referenced.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/playground',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Shape response: strip full query templates from list view, keep metadata
      const shaped: Record<string, unknown> = {};
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>;
        const shapeQueries = (queries: unknown) => {
          if (!Array.isArray(queries)) return [];
          return (queries as Record<string, unknown>[]).map(q => ({
            id: q.id,
            name: q.name,
            uuid: q.uuid,
            description: q.description,
            editorName: q.editorName,
            resourceId: q.resourceId,
            resourceUuid: q.resourceUuid,
            shared: q.shared,
            updatedAt: q.updatedAt,
            protectionStatus: q.protectionStatus,
          }));
        };
        const orgQueries = r.orgQueries as unknown;
        const userQueries = r.userQueries as unknown;
        shaped.orgQueries = shapeQueries(orgQueries);
        shaped.orgQueryCount = Array.isArray(orgQueries) ? orgQueries.length : 0;
        shaped.userQueries = shapeQueries(userQueries);
        shaped.userQueryCount = Array.isArray(userQueries) ? userQueries.length : 0;
      }
      return success(shaped);
    },
  );

  // Get query latest save
  define(
    'retool_get_query',
    {
      description: `Get the full SQL/code, configuration, and metadata for a saved Retool Query Playground query. Optionally specify a source control branch to view that version. Returns the complete query template.`,
      inputSchema: {
        queryId: z.string().describe('Query ID'),
        branchName: z.string().optional().describe('Branch name (for source-controlled queries)'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ queryId, branchName, env }) => {
      const params = branchName ? `?branchName=${encodeURIComponent(branchName)}` : '';
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/playground/${queryId}/latestSave${params}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Get query usages
  define(
    'retool_get_query_usages',
    {
      description: `Find which Retool apps and workflows reference a specific Query Playground query. Returns a list of page/workflow usages. Essential for impact analysis before modifying a shared query.`,
      inputSchema: {
        queryId: z.string().describe('Query ID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ queryId, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/playground/${queryId}/usages`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  return tools;
};
