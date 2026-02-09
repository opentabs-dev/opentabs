import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogTeamsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List teams
  define(
    'datadog_list_teams',
    {
      description: `List teams in the Datadog organization.

Returns team information including:
- Team name and handle (e.g., "billing-and-orchestration")
- Team description and summary
- Member count
- Links to team resources

This is useful for:
- Finding which team owns a service during incident response
- Discovering team handles to correlate with service tags (e.g., team:billing-and-orchestration)
- Understanding organizational structure`,
      inputSchema: {
        query: z.string().optional().describe('Filter teams by name (partial match)'),
        limit: z.number().optional().default(50).describe('Maximum number of teams to return (default: 50, max: 100)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, limit, env }) => {
      const params: Record<string, string> = {
        'page[size]': String(Math.min(limit ?? 50, 100)),
      };

      if (query) {
        params['filter[keyword]'] = query;
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/team',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      // Parse and format the response
      const response = result as {
        data?: Array<{
          id?: string;
          type?: string;
          attributes?: {
            name?: string;
            handle?: string;
            description?: string;
            summary?: string;
            user_count?: number;
            link_count?: number;
            created_at?: string;
            modified_at?: string;
          };
          relationships?: {
            team_links?: {
              links?: {
                related?: string;
              };
            };
          };
        }>;
        meta?: {
          pagination?: {
            total?: number;
          };
        };
      };

      const teams = (response.data || []).map(team => ({
        id: team.id,
        name: team.attributes?.name,
        handle: team.attributes?.handle,
        description: team.attributes?.description,
        summary: team.attributes?.summary,
        memberCount: team.attributes?.user_count,
        linkCount: team.attributes?.link_count,
        createdAt: team.attributes?.created_at,
        modifiedAt: team.attributes?.modified_at,
        linksUrl: team.relationships?.team_links?.links?.related,
      }));

      return success({
        totalCount: response.meta?.pagination?.total ?? teams.length,
        count: teams.length,
        teams,
      });
    },
  );

  // Get team by ID or handle
  define(
    'datadog_get_team',
    {
      description: `Get detailed information about a specific Datadog team by ID.

Returns team details including:
- Team name, handle, and description
- Member count
- Team links and resources

Use datadog_list_teams first to find team IDs, or use handles like "billing-and-orchestration".`,
      inputSchema: {
        teamId: z.string().describe('The team ID (UUID format, e.g., "b36a161d-8735-4c15-9ace-c9bc2dbfc5a2")'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ teamId, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v2/team/${teamId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Parse the response
      const response = result as {
        data?: {
          id?: string;
          type?: string;
          attributes?: {
            name?: string;
            handle?: string;
            description?: string;
            summary?: string;
            user_count?: number;
            link_count?: number;
            created_at?: string;
            modified_at?: string;
          };
        };
      };

      const team = response.data;
      return success({
        id: team?.id,
        name: team?.attributes?.name,
        handle: team?.attributes?.handle,
        description: team?.attributes?.description,
        summary: team?.attributes?.summary,
        memberCount: team?.attributes?.user_count,
        linkCount: team?.attributes?.link_count,
        createdAt: team?.attributes?.created_at,
        modifiedAt: team?.attributes?.modified_at,
      });
    },
  );

  return tools;
};
