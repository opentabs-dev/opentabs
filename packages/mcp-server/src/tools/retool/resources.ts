import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerRetoolResourceTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List resources (data sources)
  defineTool(
    tools,
    server,
    'retool_list_resources',
    {
      description: `List all data source resources (databases, APIs, GraphQL endpoints) configured in Retool.

Returns: resourceCount, resources[] (id, name, displayName, type, editorType, uuid, accessLevel, protected, synced), resourceFolders[].
Types include postgresql, restapi, graphql, retooldb, etc. Use retool_get_resource_usage to see which apps reference each resource.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/resources/',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Shape response: strip full connection configs (environments, production settings with credentials)
      const shaped: Record<string, unknown> = {};
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>;
        const resources = r.resources as Record<string, unknown>[] | undefined;
        if (Array.isArray(resources)) {
          shaped.resourceCount = resources.length;
          shaped.resources = resources.map(res => ({
            id: res.id,
            name: res.name,
            displayName: res.displayName,
            type: res.type,
            editorType: res.editorType,
            uuid: res.uuid,
            accessLevel: res.accessLevel,
            protected: res.protected,
            synced: res.synced,
            resourceFolderId: res.resourceFolderId,
          }));
        }
        shaped.resourceFolders = r.resourceFolders;
      }
      return success(shaped);
    },
  );

  // Get resource usage counts
  defineTool(
    tools,
    server,
    'retool_get_resource_usage',
    {
      description: `Get usage counts showing which apps and workflows reference each data source resource.

Returns: pageCounts[] ({pageCount, propertyIdentifier}), workflowCounts, queryCounts. The propertyIdentifier is the resource UUID — use retool_list_resources to map UUIDs to display names.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/organization/resourceUsageCounts?propertyType=resource',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  return tools;
};
