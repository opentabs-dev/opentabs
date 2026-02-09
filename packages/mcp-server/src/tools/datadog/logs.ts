import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogLogsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Search logs
  defineTool(
    tools,
    server,
    'datadog_search_logs',
    {
      description: `Search Datadog logs with a query. Returns log events matching the query within the specified time range.

Example queries:
- "service:my-service status:error" - Find errors from a specific service
- "kube_cluster_name:prod-1-usw2 kube_cronjob:my-cronjob" - Find logs from a specific cronjob
- "@http.status_code:>=500" - Find HTTP 5xx errors
- "host:my-host @duration:>1000" - Find slow requests
- "trace_id:8029474397976343229" - Find logs correlated with a trace (use DECIMAL format)
- "span_id:1234567890" - Find logs for a specific span

Time range is specified in hours from now (default: 24 hours).

Returns full log details including:
- message: The log message content
- status: Log level (info, warn, error, etc.)
- traceId/spanId: For correlating with APM traces (returned in decimal format)
- error: Stack trace and error details when present

IMPORTANT: When searching by trace_id or span_id, use the DECIMAL format (e.g., "8029474397976343229"), 
not the hex format (e.g., "6f6e6c6c487932bd"). The decimal IDs are returned in the "traceId" and 
"spanId" fields of log results.`,
      inputSchema: {
        query: z.string().describe('Datadog log search query (e.g., "service:my-service status:error")'),
        traceId: z.string().optional().describe('Filter by trace ID (decimal format) - added to query automatically'),
        spanId: z.string().optional().describe('Filter by span ID (decimal format) - added to query automatically'),
        timeRangeHours: z
          .number()
          .optional()
          .default(24)
          .describe('Time range in hours from now to search (default: 24)'),
        limit: z.number().optional().default(50).describe('Maximum number of logs to return (default: 50, max: 1000)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, traceId, spanId, timeRangeHours, limit, env }) => {
      const now = Date.now();
      const from = now - (timeRangeHours ?? 24) * 60 * 60 * 1000;
      const effectiveLimit = Math.min(limit ?? 50, 1000);

      // Build the effective query by appending traceId/spanId filters if provided
      let effectiveQuery = query;
      if (traceId) {
        effectiveQuery = `${effectiveQuery} trace_id:${traceId}`;
      }
      if (spanId) {
        effectiveQuery = `${effectiveQuery} span_id:${spanId}`;
      }

      const requestBody = {
        list: {
          columns: [
            { field: { path: 'status' } },
            { field: { path: 'timestamp' } },
            { field: { path: 'host' } },
            { field: { path: 'service' } },
            { field: { path: 'message' } },
          ],
          sort: {
            time: { order: 'desc' },
          },
          limit: effectiveLimit,
          time: {
            from,
            to: now,
          },
          search: {
            query: effectiveQuery,
          },
          includeEvents: true,
          computeCount: false,
          indexes: ['*'],
          executionInfo: {},
        },
        querySourceId: 'mcp_logs_search',
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/logs-analytics/list?type=logs',
        method: 'POST',
        body: requestBody,
        env: env as ServiceEnv | undefined,
      });

      // Parse and format the response
      const response = result as {
        type?: string;
        status?: string;
        hitCount?: number;
        result?: {
          events?: Array<{
            event_id?: string;
            columns?: unknown[];
            event?: {
              message?: string;
              status?: string;
              trace_id?: string;
              span_id?: string;
              custom?: {
                error?: {
                  stack?: string;
                  message?: string;
                };
                [key: string]: unknown;
              };
              tags?: string[];
              [key: string]: unknown;
            };
          }>;
        };
      };

      const events = response.result?.events || [];
      const formattedEvents = events.map(evt => {
        // Get message from columns (index 4) or fallback to event.message
        const message = evt.columns?.[4] ?? evt.event?.message ?? null;
        const status = evt.columns?.[0] ?? evt.event?.status ?? null;

        return {
          id: evt.event_id,
          timestamp: evt.columns?.[1],
          host: evt.columns?.[2],
          service: evt.columns?.[3],
          message,
          status,
          // Include trace correlation info if available
          traceId: evt.event?.trace_id,
          spanId: evt.event?.span_id,
          // Include error details if present
          error: evt.event?.custom?.error
            ? {
                stack: evt.event.custom.error.stack,
                message: evt.event.custom.error.message,
              }
            : undefined,
        };
      });

      return success({
        hitCount: response.hitCount || events.length,
        status: response.status,
        events: formattedEvents,
      });
    },
  );

  // Note: There is no Datadog API to fetch a single log by ID via session auth.
  // The datadog_search_logs tool returns full log details including message,
  // trace correlation, and error stack traces, which covers most use cases.

  return tools;
};
