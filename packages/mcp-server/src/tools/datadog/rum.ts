import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogRumTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Search RUM sessions
  define(
    'datadog_search_rum_sessions',
    {
      description: `Search Real User Monitoring (RUM) sessions to understand frontend user experiences.

RUM sessions capture frontend user activity including:
- Page views and navigation
- User actions (clicks, scrolls, form submissions)
- Frontend errors and crashes
- Performance metrics (Core Web Vitals)
- Session replay availability

Useful for:
- Finding sessions affected by backend errors (correlate with trace_id)
- Investigating user-reported issues
- Understanding user journeys before/after errors
- Identifying frontend performance problems

Example queries:
- "@session.id:abc123" - Find specific session
- "@usr.id:user123" - Find sessions by user ID
- "@usr.email:*@company.com" - Find sessions by email domain
- "service:dashboard @type:error" - Find error events in dashboard
- "@view.url_path:/checkout" - Find sessions visiting checkout page`,
      inputSchema: {
        query: z.string().describe('RUM search query (e.g., "@usr.id:user123", "service:dashboard @type:error")'),
        timeRangeHours: z
          .number()
          .optional()
          .default(24)
          .describe('Time range in hours from now to search (default: 24)'),
        limit: z.number().optional().default(50).describe('Maximum number of sessions to return (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, timeRangeHours, limit, env }) => {
      // Use ISO timestamps (Datadog RUM API expects ISO format)
      const now = Date.now();
      const from = now - (timeRangeHours ?? 24) * 60 * 60 * 1000;

      // Use flat request structure with ISO timestamps
      const requestBody = {
        filter: {
          query,
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        page: {
          limit: Math.min(limit ?? 50, 1000),
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/rum/events/search',
        method: 'POST',
        body: requestBody,
        env: env as ServiceEnv | undefined,
      });

      // Parse and format the response
      const response = result as {
        data?: Array<{
          id?: string;
          type?: string;
          attributes?: {
            timestamp?: string;
            service?: string;
            attributes?: {
              session?: {
                id?: string;
                type?: string;
                has_replay?: boolean;
              };
              view?: {
                url?: string;
                url_path?: string;
                name?: string;
              };
              usr?: {
                id?: string;
                email?: string;
                name?: string;
              };
              error?: {
                message?: string;
                type?: string;
                source?: string;
              };
              application?: {
                id?: string;
                name?: string;
              };
              device?: {
                type?: string;
                brand?: string;
                model?: string;
              };
              browser?: {
                name?: string;
                version?: string;
              };
              os?: {
                name?: string;
                version?: string;
              };
              geo?: {
                country?: string;
                city?: string;
              };
            };
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
          type: event.type,
          timestamp: event.attributes?.timestamp,
          service: event.attributes?.service,
          session: {
            id: attrs.session?.id,
            type: attrs.session?.type,
            hasReplay: attrs.session?.has_replay,
          },
          view: attrs.view,
          user: attrs.usr,
          error: attrs.error,
          application: attrs.application,
          device: attrs.device,
          browser: attrs.browser,
          os: attrs.os,
          geo: attrs.geo,
          tags: event.attributes?.tags,
        };
      });

      return success({
        totalCount: response.meta?.page?.total_count ?? events.length,
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        events,
      });
    },
  );

  // Get session replay URL
  define(
    'datadog_get_session_replay',
    {
      description: `Get the Session Replay URL for a RUM session.

Session Replay records user interactions and allows you to watch what users experienced,
including DOM snapshots, mouse movements, clicks, and scrolls.

This is invaluable for:
- Debugging user-reported issues
- Understanding the user experience during errors
- Reproducing frontend bugs
- Correlating backend traces with user actions

Prerequisites:
- Session Replay must be enabled for the application
- The session must have recording data available

Use datadog_search_rum_sessions first to find sessions with hasReplay=true.`,
      inputSchema: {
        sessionId: z.string().describe('The RUM session ID'),
        applicationId: z.string().optional().describe('The RUM application ID (optional, improves lookup)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ sessionId, applicationId, env }) => {
      // Build the replay URL directly - Datadog's internal replay URLs follow a pattern
      // Note: The actual video data requires the Datadog UI, but we provide the URL
      const baseUrl = 'https://app.datadoghq.com/rum/replay/sessions';
      let replayUrl = `${baseUrl}/${sessionId}`;

      if (applicationId) {
        replayUrl += `?applicationId=${applicationId}`;
      }

      // Also search for the session to get metadata
      // Use ISO timestamps and flat request structure
      const now = Date.now();
      const searchBody = {
        filter: {
          query: `@session.id:${sessionId}`,
          from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last 7 days
          to: new Date(now).toISOString(),
        },
        page: {
          limit: 1,
        },
      };

      let sessionInfo: {
        hasReplay: boolean;
        user?: { id?: string; email?: string };
        application?: { name?: string };
        startTime?: string;
      } | null = null;

      try {
        const result = (await sendServiceRequest('datadog', {
          endpoint: '/api/v2/rum/events/search',
          method: 'POST',
          body: searchBody,
          env: env as ServiceEnv | undefined,
        })) as {
          data?: Array<{
            attributes?: {
              timestamp?: string;
              attributes?: {
                session?: { has_replay?: boolean };
                usr?: { id?: string; email?: string };
                application?: { name?: string };
              };
            };
          }>;
        };

        if (result.data && result.data.length > 0) {
          const attrs = result.data[0].attributes?.attributes || {};
          sessionInfo = {
            hasReplay: attrs.session?.has_replay ?? false,
            user: attrs.usr,
            application: attrs.application,
            startTime: result.data[0].attributes?.timestamp,
          };
        }
      } catch {
        // Session lookup failed, but we can still return the URL
      }

      return success({
        sessionId,
        replayUrl,
        datadogUrl: replayUrl,
        sessionInfo,
        note:
          sessionInfo?.hasReplay === false
            ? 'This session may not have replay data available. Verify hasReplay is true in session search results.'
            : 'Open the URL in a browser with Datadog access to view the session replay.',
      });
    },
  );

  // Search RUM errors
  define(
    'datadog_search_rum_errors',
    {
      description: `Search for frontend errors captured by Real User Monitoring.

Returns JavaScript errors, network errors, and custom errors from frontend applications including:
- Error message and stack trace
- Browser and device information
- User context (if available)
- View/page where error occurred
- Session replay availability

Useful for:
- Investigating frontend error spikes
- Finding errors affecting specific users
- Correlating frontend errors with backend issues`,
      inputSchema: {
        query: z.string().optional().default('@type:error').describe('RUM error search query (default: "@type:error")'),
        service: z.string().optional().describe('Filter by frontend application/service name'),
        timeRangeHours: z
          .number()
          .optional()
          .default(24)
          .describe('Time range in hours from now to search (default: 24)'),
        limit: z.number().optional().default(50).describe('Maximum number of errors to return (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, service, timeRangeHours, limit, env }) => {
      // Use ISO timestamps (Datadog RUM API expects ISO format)
      const now = Date.now();
      const from = now - (timeRangeHours ?? 24) * 60 * 60 * 1000;

      let searchQuery = query || '@type:error';
      if (service) {
        searchQuery = `service:${service} ${searchQuery}`;
      }

      // Use flat request structure with ISO timestamps
      const requestBody = {
        filter: {
          query: searchQuery,
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        page: {
          limit: Math.min(limit ?? 50, 1000),
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/rum/events/search',
        method: 'POST',
        body: requestBody,
        env: env as ServiceEnv | undefined,
      });

      const response = result as {
        data?: Array<{
          id?: string;
          attributes?: {
            timestamp?: string;
            service?: string;
            attributes?: {
              error?: {
                message?: string;
                type?: string;
                source?: string;
                stack?: string;
                handling?: string;
              };
              view?: {
                url?: string;
                url_path?: string;
                name?: string;
              };
              session?: {
                id?: string;
                has_replay?: boolean;
              };
              usr?: {
                id?: string;
                email?: string;
              };
              browser?: {
                name?: string;
                version?: string;
              };
            };
          };
        }>;
        meta?: {
          page?: {
            total_count?: number;
          };
        };
      };

      const errors = (response.data || []).map(event => {
        const attrs = event.attributes?.attributes || {};
        return {
          id: event.id,
          timestamp: event.attributes?.timestamp,
          service: event.attributes?.service,
          error: {
            message: attrs.error?.message,
            type: attrs.error?.type,
            source: attrs.error?.source,
            stack: attrs.error?.stack,
            handling: attrs.error?.handling,
          },
          view: attrs.view,
          session: {
            id: attrs.session?.id,
            hasReplay: attrs.session?.has_replay,
          },
          user: attrs.usr,
          browser: attrs.browser,
        };
      });

      return success({
        totalCount: response.meta?.page?.total_count ?? errors.length,
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        errors,
      });
    },
  );

  return tools;
};
