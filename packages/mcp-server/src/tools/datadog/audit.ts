import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogAuditTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Search audit logs
  define(
    'datadog_search_audit_logs',
    {
      description: `Search Datadog audit logs to track who did what in the organization.

Audit logs capture administrative actions including:
- User logins and authentication events
- Dashboard/monitor/notebook modifications
- API key creation and usage
- Permission and role changes
- Configuration changes

Useful for:
- Security investigations
- Compliance auditing
- Tracking who modified a monitor or dashboard
- Understanding configuration drift

Example queries:
- "@evt.name:authentication" - Authentication events
- "@usr.email:user@example.com" - Actions by specific user
- "@evt.name:monitor @action:modified" - Monitor modifications`,
      inputSchema: {
        query: z.string().optional().default('*').describe('Audit log search query (default: "*")'),
        timeRangeHours: z.number().optional().default(24).describe('Time range in hours from now (default: 24)'),
        limit: z.number().optional().default(50).describe('Maximum logs to return (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, timeRangeHours, limit, env }) => {
      const now = Math.floor(Date.now() / 1000);
      const from = now - (timeRangeHours ?? 24) * 60 * 60;

      const requestBody = {
        filter: {
          query: query || '*',
          from: new Date(from * 1000).toISOString(),
          to: new Date(now * 1000).toISOString(),
        },
        sort: 'timestamp',
        page: {
          limit: Math.min(limit ?? 50, 1000),
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/audit/events/search',
        method: 'POST',
        body: requestBody,
        env: env as ServiceEnv | undefined,
      });

      const response = result as {
        data?: Array<{
          id?: string;
          type?: string;
          attributes?: {
            timestamp?: string;
            service?: string;
            attributes?: {
              evt?: {
                name?: string;
                outcome?: string;
              };
              usr?: {
                email?: string;
                id?: string;
                name?: string;
              };
              http?: {
                method?: string;
                url?: string;
                status_code?: number;
                useragent?: string;
              };
              network?: {
                client?: {
                  ip?: string;
                };
              };
              resource?: {
                type?: string;
                id?: string;
                name?: string;
              };
            };
            message?: string;
            tags?: string[];
          };
        }>;
        meta?: {
          page?: {
            total_count?: number;
          };
        };
      };

      const events = (response.data || []).map(event => {
        const attrs = event.attributes?.attributes || {};
        return {
          id: event.id,
          timestamp: event.attributes?.timestamp,
          eventName: attrs.evt?.name,
          outcome: attrs.evt?.outcome,
          user: attrs.usr,
          http: attrs.http,
          clientIp: attrs.network?.client?.ip,
          resource: attrs.resource,
          message: event.attributes?.message,
          tags: event.attributes?.tags,
        };
      });

      return success({
        totalCount: response.meta?.page?.total_count ?? events.length,
        timeRange: {
          from: new Date(from * 1000).toISOString(),
          to: new Date(now * 1000).toISOString(),
        },
        events,
      });
    },
  );

  // Get audit log event types
  define(
    'datadog_list_audit_event_types',
    {
      description: `List available audit log event types for reference.

Returns categories of events that can be searched in audit logs,
helping you construct effective audit log queries.`,
      inputSchema: {},
    },
    async () => {
      // Common audit event types for reference
      const eventTypes = {
        authentication: {
          events: ['login', 'logout', 'login_failure', 'mfa_challenge'],
          description: 'User authentication events',
        },
        api_key: {
          events: ['created', 'modified', 'deleted'],
          description: 'API key management',
        },
        application_key: {
          events: ['created', 'modified', 'deleted'],
          description: 'Application key management',
        },
        dashboard: {
          events: ['created', 'modified', 'deleted', 'accessed'],
          description: 'Dashboard operations',
        },
        monitor: {
          events: ['created', 'modified', 'deleted', 'muted', 'unmuted'],
          description: 'Monitor operations',
        },
        notebook: {
          events: ['created', 'modified', 'deleted'],
          description: 'Notebook operations',
        },
        downtime: {
          events: ['created', 'modified', 'deleted'],
          description: 'Downtime scheduling',
        },
        user: {
          events: ['created', 'modified', 'deleted', 'invited'],
          description: 'User management',
        },
        role: {
          events: ['created', 'modified', 'deleted', 'assigned', 'unassigned'],
          description: 'Role management',
        },
        slo: {
          events: ['created', 'modified', 'deleted'],
          description: 'SLO operations',
        },
        log_configuration: {
          events: ['pipeline_created', 'pipeline_modified', 'index_modified'],
          description: 'Log configuration changes',
        },
      };

      return success({
        note: 'Use @evt.name:<event> in queries to filter by event type',
        examples: [
          '@evt.name:authentication - All auth events',
          '@evt.name:monitor @action:modified - Monitor modifications',
          '@usr.email:user@example.com - Actions by specific user',
        ],
        eventTypes,
      });
    },
  );

  return tools;
};
