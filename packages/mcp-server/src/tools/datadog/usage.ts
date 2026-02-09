import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogUsageTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Get usage summary
  define(
    'datadog_get_usage_summary',
    {
      description: `Get Datadog usage summary statistics.

Returns usage metrics for the organization including:
- Host counts (infrastructure, APM, containers)
- Log ingestion volume
- Custom metrics count
- Synthetics test usage
- RUM session counts

Useful for:
- Cost monitoring and optimization
- Capacity planning
- Understanding data volumes`,
      inputSchema: {
        startMonth: z.string().optional().describe('Start month in YYYY-MM format (default: current month)'),
        endMonth: z.string().optional().describe('End month in YYYY-MM format (default: current month)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Environment to query (production or staging). Defaults to production.'),
      },
    },
    async ({ startMonth, endMonth, env }) => {
      const now = new Date();
      const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const params: Record<string, string> = {
        start_month: startMonth || defaultMonth,
        end_month: endMonth || defaultMonth,
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/usage/summary',
        method: 'GET',
        params,
        env,
      });

      const response = result as {
        usage?: Array<{
          month?: string;
          org_name?: string;
          agent_host_count?: number;
          apm_host_count?: number;
          aws_host_count?: number;
          azure_host_count?: number;
          container_count?: number;
          gcp_host_count?: number;
          indexed_logs_bytes?: number;
          logs_ingested_bytes?: number;
          custom_metrics_average?: number;
          rum_session_count?: number;
          synthetics_browser_test_runs?: number;
          synthetics_api_test_runs?: number;
          profiled_hosts?: number;
          profiled_containers?: number;
        }>;
      };

      const usage = (response.usage || []).map(u => ({
        month: u.month,
        organization: u.org_name,
        hosts: {
          agents: u.agent_host_count,
          apm: u.apm_host_count,
          aws: u.aws_host_count,
          azure: u.azure_host_count,
          gcp: u.gcp_host_count,
          containers: u.container_count,
        },
        logs: {
          indexedBytes: u.indexed_logs_bytes,
          ingestedBytes: u.logs_ingested_bytes,
          indexedGB: u.indexed_logs_bytes ? Math.round((u.indexed_logs_bytes / 1e9) * 100) / 100 : undefined,
          ingestedGB: u.logs_ingested_bytes ? Math.round((u.logs_ingested_bytes / 1e9) * 100) / 100 : undefined,
        },
        customMetrics: u.custom_metrics_average,
        rum: {
          sessions: u.rum_session_count,
        },
        synthetics: {
          browserTests: u.synthetics_browser_test_runs,
          apiTests: u.synthetics_api_test_runs,
        },
        profiling: {
          hosts: u.profiled_hosts,
          containers: u.profiled_containers,
        },
      }));

      return success({
        timeRange: {
          startMonth: startMonth || defaultMonth,
          endMonth: endMonth || defaultMonth,
        },
        usage,
      });
    },
  );

  // Get hourly usage for logs
  define(
    'datadog_get_logs_usage',
    {
      description: `Get detailed hourly usage for log ingestion.

Returns hourly breakdown of:
- Logs indexed by retention
- Logs ingested
- Live logs analyzed

Useful for:
- Identifying log volume spikes
- Cost analysis by time of day
- Capacity planning`,
      inputSchema: {
        startHour: z.string().optional().describe('Start hour in ISO format (default: 24 hours ago)'),
        endHour: z.string().optional().describe('End hour in ISO format (default: now)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Environment to query (production or staging). Defaults to production.'),
      },
    },
    async ({ startHour, endHour, env }) => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const params: Record<string, string> = {
        start_hr: startHour || dayAgo.toISOString(),
        end_hr: endHour || now.toISOString(),
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/usage/logs',
        method: 'GET',
        params,
        env,
      });

      const response = result as {
        usage?: Array<{
          hour?: string;
          logs_indexed?: number;
          logs_ingested_bytes?: number;
          live_indexed_events_count?: number;
          rehydrated_indexed_events_count?: number;
        }>;
      };

      const usage = (response.usage || []).map(u => ({
        hour: u.hour,
        logsIndexed: u.logs_indexed,
        logsIngestedBytes: u.logs_ingested_bytes,
        logsIngestedMB: u.logs_ingested_bytes ? Math.round((u.logs_ingested_bytes / 1e6) * 100) / 100 : undefined,
        liveIndexedEvents: u.live_indexed_events_count,
        rehydratedEvents: u.rehydrated_indexed_events_count,
      }));

      return success({
        timeRange: {
          start: startHour || dayAgo.toISOString(),
          end: endHour || now.toISOString(),
        },
        hourlyUsage: usage,
        summary: {
          totalLogsIndexed: usage.reduce((sum, u) => sum + (u.logsIndexed ?? 0), 0),
          totalIngestedMB: Math.round(usage.reduce((sum, u) => sum + (u.logsIngestedMB ?? 0), 0) * 100) / 100,
        },
      });
    },
  );

  // Get usage attribution (top consumers)
  define(
    'datadog_get_usage_attribution',
    {
      description: `Get usage attribution by tag to understand cost allocation.

Shows usage breakdown by:
- Team/service tags
- Environment
- Custom tags

Useful for:
- Chargebacks to teams
- Identifying top consumers
- Cost optimization opportunities`,
      inputSchema: {
        startMonth: z.string().describe('Start month in YYYY-MM format'),
        fields: z.string().optional().default('*').describe('Comma-separated usage fields (default: "*" for all)'),
        tagKeys: z.string().optional().describe('Comma-separated tag keys to group by (e.g., "team,service,env")'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Environment to query (production or staging). Defaults to production.'),
      },
    },
    async ({ startMonth, fields, tagKeys, env }) => {
      const params: Record<string, string> = {
        start_month: startMonth,
        fields: fields || '*',
      };

      if (tagKeys) {
        params.tag_breakdown_keys = tagKeys;
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/usage/attribution',
        method: 'GET',
        params,
        env,
      });

      return success(result);
    },
  );

  return tools;
};
