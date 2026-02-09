import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogWatchdogTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Get Watchdog stories (alerts/anomalies detected by ML)
  define(
    'datadog_get_watchdog_stories',
    {
      description: `Get Watchdog stories - ML-detected anomalies and alerts.

Watchdog automatically detects:
- **Error rate anomalies**: Unusual spikes in errors
- **Latency anomalies**: Services with abnormal response times
- **Throughput anomalies**: Unexpected changes in request volume
- **Performance regressions**: Deployments causing issues

This is essential for incident response to see what Datadog's ML has detected.

Returns story metadata including category, severity, and affected services.`,
      inputSchema: {
        timeRangeHours: z.number().optional().default(24).describe('Time range in hours from now (default: 24)'),
        category: z
          .enum(['apm', 'infrastructure', 'logs', 'error_tracking', 'all'])
          .optional()
          .describe('Filter by category (default: all)'),
        limit: z.number().optional().default(50).describe('Maximum stories to return (default: 50)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ timeRangeHours, category, limit, datadogEnv }) => {
      const now = Date.now();
      const from = now - (timeRangeHours ?? 24) * 60 * 60 * 1000;

      const params: Record<string, string> = {
        from_ts: String(from),
        to_ts: String(now),
        limit: String(limit ?? 50),
      };

      if (category && category !== 'all') {
        params.category = category;
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/watchdog/stories',
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });

      const response = result as {
        data?: Array<{
          id?: string;
          type?: string;
          attributes?: {
            title?: string;
            description?: string;
            category?: string;
            severity?: string;
            status?: string;
            start_time?: number;
            end_time?: number;
            url?: string;
            tags?: string[];
            affected_entities?: Array<{
              type?: string;
              name?: string;
            }>;
          };
        }>;
        meta?: {
          page?: {
            total_count?: number;
          };
        };
      };

      const stories = (response.data || []).map(story => ({
        id: story.id,
        title: story.attributes?.title,
        description: story.attributes?.description,
        category: story.attributes?.category,
        severity: story.attributes?.severity,
        status: story.attributes?.status,
        startTime: story.attributes?.start_time ? new Date(story.attributes.start_time).toISOString() : undefined,
        endTime: story.attributes?.end_time ? new Date(story.attributes.end_time).toISOString() : undefined,
        url: story.attributes?.url,
        tags: story.attributes?.tags,
        affectedEntities: story.attributes?.affected_entities,
      }));

      return success({
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        totalCount: response.meta?.page?.total_count ?? stories.length,
        count: stories.length,
        stories,
        watchdogUrl: 'https://app.datadoghq.com/watchdog',
      });
    },
  );

  // Get Watchdog insights/anomalies - using span analytics to find anomalies
  define(
    'datadog_get_watchdog_insights',
    {
      description: `Analyze service health and detect anomalies using APM data.

Since the Watchdog API is not available via browser session auth, this tool provides 
similar anomaly detection by analyzing:
- **Error spikes**: Services with high error rates
- **Latency issues**: Services with elevated p99 latency  
- **Recent errors**: Grouped error patterns by service and type

This is useful for:
- Identifying services experiencing issues
- Finding error patterns during incidents
- Understanding service health across the system

For dedicated Watchdog insights, access the Datadog Watchdog page directly:
https://app.datadoghq.com/watchdog`,
      inputSchema: {
        timeRangeHours: z
          .number()
          .optional()
          .default(1)
          .describe('Time range in hours from now to analyze (default: 1)'),
        service: z.string().optional().describe('Filter by specific service name'),
        env: z.string().optional().default('production').describe('Environment to analyze (default: production)'),
        limit: z.number().optional().default(20).describe('Maximum number of insights to return (default: 20)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ timeRangeHours, service, env, limit, datadogEnv }) => {
      const now = Date.now();
      const from = now - (timeRangeHours ?? 1) * 60 * 60 * 1000;

      // Build query for error spans
      let query = 'status:error';
      if (service) {
        query = `service:${service} ${query}`;
      }
      if (env) {
        query = `env:${env} ${query}`;
      }

      // Search for error spans to identify anomalies
      // Spans API requires data.attributes wrapper with ISO timestamps
      const requestBody = {
        data: {
          type: 'search_request',
          attributes: {
            filter: {
              query,
              from: new Date(from).toISOString(),
              to: new Date(now).toISOString(),
            },
            page: {
              limit: 100, // Get more spans to aggregate
            },
          },
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/spans/events/search',
        method: 'POST',
        body: requestBody,
        env: datadogEnv as ServiceEnv | undefined,
      });

      const response = result as {
        data?: Array<{
          id?: string;
          attributes?: {
            service?: string;
            resource_name?: string;
            operation_name?: string;
            status?: string;
            start_timestamp?: string;
            custom?: {
              error?: {
                message?: string;
                type?: string;
              };
              [key: string]: unknown;
            };
          };
        }>;
        meta?: {
          status?: string;
        };
      };

      // Aggregate errors by service to identify patterns
      const serviceErrorMap = new Map<
        string,
        {
          service: string;
          errorCount: number;
          errorTypes: Set<string>;
          resources: Set<string>;
          latestError?: string;
          latestTimestamp?: string;
        }
      >();

      for (const span of response.data || []) {
        const svc = span.attributes?.service || 'unknown';
        const existing = serviceErrorMap.get(svc) || {
          service: svc,
          errorCount: 0,
          errorTypes: new Set<string>(),
          resources: new Set<string>(),
        };

        existing.errorCount++;
        if (span.attributes?.custom?.error?.type) {
          existing.errorTypes.add(span.attributes.custom.error.type);
        }
        if (span.attributes?.resource_name) {
          existing.resources.add(span.attributes.resource_name);
        }
        if (!existing.latestTimestamp || (span.attributes?.start_timestamp || '') > existing.latestTimestamp) {
          existing.latestTimestamp = span.attributes?.start_timestamp;
          existing.latestError =
            span.attributes?.custom?.error?.message || span.attributes?.resource_name || 'Unknown error';
        }

        serviceErrorMap.set(svc, existing);
      }

      // Convert to sorted list of insights
      const insights = [...serviceErrorMap.values()]
        .sort((a, b) => b.errorCount - a.errorCount)
        .slice(0, limit ?? 20)
        .map(svc => ({
          type: 'error_spike',
          severity: svc.errorCount > 10 ? 'high' : svc.errorCount > 5 ? 'medium' : 'low',
          service: svc.service,
          errorCount: svc.errorCount,
          errorTypes: [...svc.errorTypes],
          affectedResources: [...svc.resources].slice(0, 5),
          latestError: svc.latestError,
          latestTimestamp: svc.latestTimestamp,
          investigateUrl: `https://app.datadoghq.com/apm/traces?query=service:${encodeURIComponent(svc.service)}%20status:error`,
        }));

      return success({
        note: 'Analysis based on APM error spans. For full Watchdog insights, visit https://app.datadoghq.com/watchdog',
        timeRange: {
          from: new Date(from).toISOString(),
          to: new Date(now).toISOString(),
        },
        totalErrorSpans: response.data?.length || 0,
        affectedServices: insights.length,
        insights,
      });
    },
  );

  return tools;
};
