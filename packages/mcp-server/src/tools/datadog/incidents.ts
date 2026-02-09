// Incidents API - Full incident management tools
// Note: Some endpoints require the Incident Management feature to be enabled

import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogIncidentsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List incidents
  defineTool(
    tools,
    server,
    'datadog_list_incidents',
    {
      description: `List incidents from Datadog Incident Management.

Returns active and recent incidents including:
- Incident title and severity
- Status (active, stable, resolved)
- Commander and responders
- Affected services
- Timeline of key events

This is critical during on-call to:
- See if there are active incidents
- Check if your issue is related to known incidents
- Find historical incidents for context

Note: Requires Incident Management feature. Returns empty if not enabled.`,
      inputSchema: {
        status: z
          .enum(['active', 'stable', 'resolved', 'all'])
          .optional()
          .default('all')
          .describe('Filter by incident status (default: all)'),
        query: z.string().optional().describe('Search query to filter incidents'),
        timeRangeHours: z.number().optional().default(168).describe('Time range in hours (default: 168 = 1 week)'),
        limit: z.number().optional().default(50).describe('Maximum incidents to return (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ status, query, limit, env }) => {
      try {
        const params: Record<string, string> = {
          'page[size]': String(limit ?? 50),
        };

        // Build query
        let searchQuery = query || '';
        if (status && status !== 'all') {
          searchQuery = `state:${status} ${searchQuery}`.trim();
        }
        if (searchQuery) {
          params.query = searchQuery;
        }

        const result = await sendServiceRequest('datadog', {
          endpoint: '/api/v2/incidents',
          method: 'GET',
          params,
          env: env as ServiceEnv | undefined,
        });

        const response = result as {
          data?: Array<{
            id?: string;
            type?: string;
            attributes?: {
              title?: string;
              severity?: string;
              state?: string;
              created?: string;
              modified?: string;
              resolved?: string;
              customer_impact_scope?: string;
              customer_impact_start?: string;
              customer_impact_end?: string;
              customer_impacted?: boolean;
              detected?: string;
              fields?: Record<
                string,
                {
                  type?: string;
                  value?: unknown;
                }
              >;
            };
            relationships?: {
              commander_user?: {
                data?: {
                  id?: string;
                };
              };
              created_by_user?: {
                data?: {
                  id?: string;
                };
              };
            };
          }>;
          meta?: {
            pagination?: {
              total_count?: number;
            };
          };
          included?: Array<{
            id?: string;
            type?: string;
            attributes?: {
              name?: string;
              email?: string;
            };
          }>;
        };

        // Build user lookup map
        const userMap = new Map<string, { name?: string; email?: string }>();
        for (const included of response.included || []) {
          if (included.type === 'users' && included.id) {
            userMap.set(included.id, {
              name: included.attributes?.name,
              email: included.attributes?.email,
            });
          }
        }

        const incidents = (response.data || []).map(incident => {
          const commanderId = incident.relationships?.commander_user?.data?.id;
          const commander = commanderId ? userMap.get(commanderId) : undefined;

          return {
            id: incident.id,
            title: incident.attributes?.title,
            severity: incident.attributes?.severity,
            state: incident.attributes?.state,
            created: incident.attributes?.created,
            modified: incident.attributes?.modified,
            resolved: incident.attributes?.resolved,
            detected: incident.attributes?.detected,
            customerImpacted: incident.attributes?.customer_impacted,
            customerImpactScope: incident.attributes?.customer_impact_scope,
            customerImpactStart: incident.attributes?.customer_impact_start,
            customerImpactEnd: incident.attributes?.customer_impact_end,
            commander: commander,
            datadogUrl: `https://app.datadoghq.com/incidents/${incident.id}`,
          };
        });

        return success({
          totalCount: response.meta?.pagination?.total_count ?? incidents.length,
          incidents,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('404') || errorMessage.includes('not found')) {
          return success({
            totalCount: 0,
            incidents: [],
            note: 'Incident Management feature may not be enabled for this organization.',
          });
        }
        throw err;
      }
    },
  );

  // Get specific incident
  defineTool(
    tools,
    server,
    'datadog_get_incident',
    {
      description: `Get detailed information about a specific incident.

Returns comprehensive incident details including:
- Full incident description and title
- Severity and current status
- Timeline of events and actions
- Commander and responders
- Affected services and customers
- Postmortem status

Use this to get full context on an incident found in datadog_list_incidents.`,
      inputSchema: {
        incidentId: z.string().describe('The incident ID'),
        includeTimeline: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include incident timeline events (default: true)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ incidentId, includeTimeline, env }) => {
      try {
        const params: Record<string, string> = {
          include: 'users,attachments',
        };

        const result = await sendServiceRequest('datadog', {
          endpoint: `/api/v2/incidents/${incidentId}`,
          method: 'GET',
          params,
          env: env as ServiceEnv | undefined,
        });

        const response = result as {
          data?: {
            id?: string;
            type?: string;
            attributes?: {
              title?: string;
              severity?: string;
              state?: string;
              created?: string;
              modified?: string;
              resolved?: string;
              customer_impact_scope?: string;
              customer_impact_start?: string;
              customer_impact_end?: string;
              customer_impacted?: boolean;
              detected?: string;
              postmortem_id?: string;
              notification_handles?: Array<{
                display_name?: string;
                handle?: string;
              }>;
              fields?: Record<
                string,
                {
                  type?: string;
                  value?: unknown;
                }
              >;
            };
            relationships?: {
              commander_user?: {
                data?: {
                  id?: string;
                };
              };
            };
          };
          included?: Array<{
            id?: string;
            type?: string;
            attributes?: {
              name?: string;
              email?: string;
            };
          }>;
        };

        const incident = response.data;
        if (!incident) {
          return success({
            incidentId,
            message: 'Incident not found',
          });
        }

        // Get timeline if requested
        let timeline: Array<{
          id?: string;
          type?: string;
          timestamp?: string;
          content?: string;
          author?: string;
        }> = [];

        if (includeTimeline) {
          try {
            const timelineResult = (await sendServiceRequest('datadog', {
              endpoint: `/api/v2/incidents/${incidentId}/timeline`,
              method: 'GET',
              env: env as ServiceEnv | undefined,
            })) as {
              data?: Array<{
                id?: string;
                type?: string;
                attributes?: {
                  created?: string;
                  modified?: string;
                  content?: {
                    type?: string;
                    content?: string;
                  };
                };
              }>;
            };

            timeline = (timelineResult.data || []).map(item => ({
              id: item.id,
              type: item.type,
              timestamp: item.attributes?.created,
              content: item.attributes?.content?.content,
            }));
          } catch {
            // Timeline fetch failed, continue without it
          }
        }

        // Extract custom fields
        const customFields: Record<string, unknown> = {};
        if (incident.attributes?.fields) {
          for (const [key, field] of Object.entries(incident.attributes.fields)) {
            customFields[key] = field.value;
          }
        }

        return success({
          id: incident.id,
          title: incident.attributes?.title,
          severity: incident.attributes?.severity,
          state: incident.attributes?.state,
          created: incident.attributes?.created,
          modified: incident.attributes?.modified,
          resolved: incident.attributes?.resolved,
          detected: incident.attributes?.detected,
          customerImpacted: incident.attributes?.customer_impacted,
          customerImpactScope: incident.attributes?.customer_impact_scope,
          customerImpactStart: incident.attributes?.customer_impact_start,
          customerImpactEnd: incident.attributes?.customer_impact_end,
          postmortemId: incident.attributes?.postmortem_id,
          notificationHandles: incident.attributes?.notification_handles,
          customFields,
          timeline,
          datadogUrl: `https://app.datadoghq.com/incidents/${incident.id}`,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('404') || errorMessage.includes('not found')) {
          return success({
            incidentId,
            message: 'Incident not found or Incident Management feature not enabled.',
          });
        }
        throw err;
      }
    },
  );

  // Search incidents
  defineTool(
    tools,
    server,
    'datadog_search_incidents',
    {
      description: `Search incidents by query string.

Example queries:
- "severity:SEV-1" - Find SEV-1 incidents
- "state:active" - Find active incidents
- "service:billing" - Find incidents affecting billing service
- "commander:user@example.com" - Find incidents led by specific person`,
      inputSchema: {
        query: z.string().describe('Search query for incidents'),
        limit: z.number().optional().default(20).describe('Maximum results (default: 20)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, limit, env }) => {
      try {
        const params: Record<string, string> = {
          query,
          'page[size]': String(limit ?? 20),
        };

        const result = await sendServiceRequest('datadog', {
          endpoint: '/api/v2/incidents/search',
          method: 'GET',
          params,
          env: env as ServiceEnv | undefined,
        });

        const response = result as {
          data?: {
            type?: string;
            attributes?: {
              incidents?: Array<{
                data?: {
                  id?: string;
                  attributes?: {
                    title?: string;
                    severity?: string;
                    state?: string;
                    created?: string;
                  };
                };
              }>;
              total?: number;
            };
          };
        };

        const incidents = (response.data?.attributes?.incidents || []).map(inc => ({
          id: inc.data?.id,
          title: inc.data?.attributes?.title,
          severity: inc.data?.attributes?.severity,
          state: inc.data?.attributes?.state,
          created: inc.data?.attributes?.created,
          datadogUrl: `https://app.datadoghq.com/incidents/${inc.data?.id}`,
        }));

        return success({
          query,
          totalCount: response.data?.attributes?.total ?? incidents.length,
          incidents,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('404') || errorMessage.includes('not found')) {
          return success({
            query,
            totalCount: 0,
            incidents: [],
            note: 'Incident Management feature may not be enabled for this organization.',
          });
        }
        throw err;
      }
    },
  );

  // List incident services
  defineTool(
    tools,
    server,
    'datadog_list_incident_services',
    {
      description: `List all services that have been configured for incident management. 

Useful for understanding which services can be associated with incidents and 
finding the correct service name when creating or filtering incidents.`,
      inputSchema: {
        filter: z.string().optional().describe('Filter services by name'),
        pageSize: z.number().optional().default(50).describe('Number of services to return (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ filter, pageSize, env }) => {
      const params: Record<string, string> = {
        'page[size]': `${pageSize ?? 50}`,
      };
      if (filter) params['filter[name]'] = filter;

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/incidents/config/services',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
