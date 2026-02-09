import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogMetricsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Query metrics
  define(
    'datadog_query_metrics',
    {
      description: `Query time series metrics data from Datadog.

Example queries:
- "avg:system.cpu.user{*}" - Average CPU usage across all hosts
- "sum:my.custom.metric{env:production}" - Sum of custom metric for production
- "avg:trace.servlet.request.hits{service:my-service}.as_count()" - Request count for a service

Time range is specified in hours from now (default: 1 hour).`,
      inputSchema: {
        query: z.string().describe('Datadog metrics query string'),
        timeRangeHours: z.number().optional().default(1).describe('Time range in hours from now (default: 1)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, timeRangeHours, env }) => {
      const now = Math.floor(Date.now() / 1000);
      const from = now - (timeRangeHours ?? 1) * 60 * 60;

      const params = {
        query,
        from: `${from}`,
        to: `${now}`,
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/query',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // List metrics
  define(
    'datadog_list_metrics',
    {
      description: `List available metric names, optionally filtered by a search string.

Note: The Datadog API returns all metrics and filtering is done client-side.
For large organizations, consider using a specific search term.

Examples:
- search: "system.cpu" - Find CPU-related metrics
- search: "billing-lifecycle" - Find service-specific metrics
- search: "trace." - Find APM trace metrics`,
      inputSchema: {
        search: z.string().optional().describe('Filter metrics by name (case-insensitive substring match)'),
        timeRangeHours: z
          .number()
          .optional()
          .default(24)
          .describe('Time range in hours to look for active metrics (default: 24)'),
        limit: z.number().optional().default(100).describe('Maximum number of metrics to return (default: 100)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ search, timeRangeHours, limit, env }) => {
      const now = Math.floor(Date.now() / 1000);
      const from = now - (timeRangeHours ?? 24) * 60 * 60;

      const params: Record<string, string> = {
        from: `${from}`,
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/metrics',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      const response = result as { metrics?: string[] };
      let metrics = response.metrics || [];

      // Filter client-side since the API doesn't support server-side filtering
      if (search) {
        const searchLower = search.toLowerCase();
        metrics = metrics.filter(m => m.toLowerCase().includes(searchLower));
      }

      // Apply limit
      const effectiveLimit = limit ?? 100;
      const limitedMetrics = metrics.slice(0, effectiveLimit);

      return success({
        totalMatching: metrics.length,
        returned: limitedMetrics.length,
        metrics: limitedMetrics,
      });
    },
  );

  // Get metric metadata
  define(
    'datadog_get_metric_metadata',
    {
      description: `Get metadata for a specific Datadog metric.

Returns:
- Description (human-readable explanation of what the metric measures)
- Unit (bytes, seconds, percent, etc.) and per-unit for rate metrics
- Metric type (gauge, count, rate)
- Integration name (which Datadog integration provides this metric)
- Short name and statsd interval

Use this after datadog_list_metrics to understand what a specific metric means before building queries with datadog_query_metrics.`,
      inputSchema: {
        metricName: z.string().describe('The full metric name (e.g., "system.cpu.user")'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ metricName, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/metrics/${metricName}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
