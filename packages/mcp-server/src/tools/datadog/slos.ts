import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogSLOTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List SLOs
  define(
    'datadog_list_slos',
    {
      description: `List Service Level Objectives (SLOs) in the organization.

SLOs can be filtered by name or tags. Returns SLO definitions including thresholds, targets, and types.

Example tag filters:
- "service:my-service" - Filter by service tag
- "team:platform" - Filter by team tag
- "env:production" - Filter by environment`,
      inputSchema: {
        query: z.string().optional().describe('Search query to filter SLOs by name'),
        tags: z
          .string()
          .optional()
          .describe('Comma-separated tags to filter by (e.g., "service:my-service,env:production")'),
        limit: z.number().optional().default(100).describe('Maximum number of SLOs to return (default: 100)'),
        offset: z.number().optional().default(0).describe('Offset for pagination (default: 0)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, tags, limit, offset, datadogEnv }) => {
      const params: Record<string, string> = {
        limit: `${limit ?? 100}`,
        offset: `${offset ?? 0}`,
      };
      if (query) params.query = query;
      if (tags) params.tags = tags;

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/slo',
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });

      // Format the response to be more useful
      const response = result as {
        data?: Array<{
          id?: string;
          name?: string;
          description?: string;
          type?: string;
          tags?: string[];
          thresholds?: Array<{
            timeframe?: string;
            target?: number;
            target_display?: string;
            warning?: number;
            warning_display?: string;
          }>;
          query?: {
            numerator?: string;
            denominator?: string;
          };
          monitor_ids?: number[];
          creator?: {
            name?: string;
            email?: string;
          };
          created_at?: number;
          modified_at?: number;
        }>;
        metadata?: {
          page?: {
            total_count?: number;
            total_filtered_count?: number;
          };
        };
      };

      const slos = response.data || [];
      const formattedSLOs = slos.map(slo => ({
        id: slo.id,
        name: slo.name,
        description: slo.description,
        type: slo.type,
        tags: slo.tags,
        thresholds: slo.thresholds,
        query: slo.query,
        monitorIds: slo.monitor_ids,
        creator: slo.creator,
        createdAt: slo.created_at ? new Date(slo.created_at * 1000).toISOString() : undefined,
        modifiedAt: slo.modified_at ? new Date(slo.modified_at * 1000).toISOString() : undefined,
      }));

      return success({
        count: formattedSLOs.length,
        totalCount: response.metadata?.page?.total_count,
        slos: formattedSLOs,
      });
    },
  );

  // Get SLO by ID
  define(
    'datadog_get_slo',
    {
      description: `Get detailed information about a specific SLO by its ID.
Returns the full SLO definition including thresholds, query, and configuration.`,
      inputSchema: {
        sloId: z.string().describe('The SLO ID (e.g., "4a8a852b58e4552c9c8aefd4eebab0e7")'),
        withConfiguredAlertIds: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include alert IDs configured for this SLO'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ sloId, withConfiguredAlertIds, datadogEnv }) => {
      const params: Record<string, string> = {};
      if (withConfiguredAlertIds) {
        params.with_configured_alert_ids = 'true';
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/slo/${sloId}`,
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Get SLO history
  define(
    'datadog_get_slo_history',
    {
      description: `Get the historical SLI data and error budget for an SLO over a time range.

Returns:
- Overall SLI value for the period
- Error budget remaining
- Historical data points
- Group-level breakdowns (if applicable)

This is useful for understanding SLO performance over time and tracking error budget consumption.`,
      inputSchema: {
        sloId: z.string().describe('The SLO ID'),
        timeRangeHours: z
          .number()
          .optional()
          .default(24)
          .describe('Time range in hours to fetch history for (default: 24)'),
        target: z.number().optional().describe('Optional target threshold to use for calculations'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ sloId, timeRangeHours, target, datadogEnv }) => {
      const now = Math.floor(Date.now() / 1000);
      const from = now - (timeRangeHours ?? 24) * 60 * 60;

      const params: Record<string, string> = {
        from_ts: `${from}`,
        to_ts: `${now}`,
      };
      if (target !== undefined) {
        params.target = `${target}`;
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/slo/${sloId}/history`,
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });

      // Format the response
      const response = result as {
        data?: {
          overall?: {
            sli_value?: number;
            span_precision?: number;
            name?: string;
            precision?: {
              [key: string]: number;
            };
            preview?: boolean;
            error_budget_remaining?: {
              value?: number;
              unit?: string;
            };
          };
          series?: {
            numerator?: {
              count?: number;
              sum?: number;
              values?: number[];
              times?: number[];
            };
            denominator?: {
              count?: number;
              sum?: number;
              values?: number[];
              times?: number[];
            };
          };
          thresholds?: {
            [timeframe: string]: {
              target?: number;
              target_display?: string;
              timeframe?: string;
            };
          };
          from_ts?: number;
          to_ts?: number;
          type?: string;
          type_id?: number;
        };
        errors?: Array<{ error: string }>;
      };

      if (response.errors && response.errors.length > 0) {
        return success({
          success: false,
          errors: response.errors,
        });
      }

      const data = response.data;
      return success({
        sloId,
        timeRange: {
          from: data?.from_ts ? new Date(data.from_ts * 1000).toISOString() : undefined,
          to: data?.to_ts ? new Date(data.to_ts * 1000).toISOString() : undefined,
        },
        overall: data?.overall
          ? {
              sliValue: data.overall.sli_value,
              errorBudgetRemaining: data.overall.error_budget_remaining,
            }
          : undefined,
        thresholds: data?.thresholds,
        type: data?.type,
      });
    },
  );

  // Search SLOs
  define(
    'datadog_search_slos',
    {
      description: `Search for SLOs by name, tags, or other criteria.

Example searches:
- "billing" - Find SLOs with billing in the name
- "type:metric" - Find metric-based SLOs
- "service:billing-lifecycle-dgs" - Find SLOs for a specific service`,
      inputSchema: {
        query: z.string().describe('Search query string'),
        limit: z.number().optional().default(50).describe('Maximum number of results (default: 50)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, limit, datadogEnv }) => {
      const params: Record<string, string> = {
        query,
        limit: `${limit ?? 50}`,
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/slo',
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });

      const response = result as {
        data?: Array<{
          id?: string;
          name?: string;
          description?: string;
          type?: string;
          tags?: string[];
          thresholds?: Array<{
            timeframe?: string;
            target?: number;
          }>;
        }>;
      };

      const slos = response.data || [];
      return success({
        count: slos.length,
        slos: slos.map(slo => ({
          id: slo.id,
          name: slo.name,
          description: slo.description,
          type: slo.type,
          tags: slo.tags,
          thresholds: slo.thresholds,
        })),
      });
    },
  );

  // Get error budget status for SLOs
  define(
    'datadog_get_error_budget_status',
    {
      description: `Get error budget status for SLOs to understand reliability health.

Returns for each matching SLO:
- **Current SLI value**: The actual reliability percentage
- **Target**: The SLO target (e.g., 99.9%)
- **Error budget remaining**: How much of your error budget is left
- **Error budget consumption rate**: How fast you're consuming budget
- **Status**: healthy, warning, critical based on budget remaining

This is essential for:
- On-call to quickly assess if a service is at risk
- Understanding if current errors are burning through budget
- Prioritizing which issues to fix based on SLO impact

Use tags like "service:billing-lifecycle-dgs" to filter to specific services.`,
      inputSchema: {
        service: z.string().optional().describe('Filter SLOs by service name'),
        tags: z
          .string()
          .optional()
          .describe('Comma-separated tags to filter by (e.g., "team:platform,env:production")'),
        query: z.string().optional().describe('Search query to filter SLOs by name'),
        timeframe: z
          .enum(['7d', '30d', '90d'])
          .optional()
          .default('30d')
          .describe('Timeframe for SLO calculation (default: 30d)'),
        datadogEnv: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ service, tags, query, timeframe, datadogEnv }) => {
      // First, get the list of SLOs
      const params: Record<string, string> = {
        limit: '100',
      };

      // Build filter
      const filterParts: string[] = [];
      if (service) filterParts.push(`service:${service}`);
      if (tags) filterParts.push(tags);
      if (filterParts.length > 0) {
        params.tags = filterParts.join(',');
      }
      if (query) params.query = query;

      const listResult = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/slo',
        method: 'GET',
        params,
        env: datadogEnv as ServiceEnv | undefined,
      });

      const listResponse = listResult as {
        data?: Array<{
          id?: string;
          name?: string;
          description?: string;
          type?: string;
          tags?: string[];
          thresholds?: Array<{
            timeframe?: string;
            target?: number;
            target_display?: string;
            warning?: number;
          }>;
        }>;
      };

      const slos = listResponse.data || [];
      if (slos.length === 0) {
        return success({
          message: 'No SLOs found matching the criteria',
          filters: { service, tags, query },
        });
      }

      // Get history for each SLO to calculate error budget
      const tf = timeframe ?? '30d';
      const timeframeHours = tf === '7d' ? 168 : tf === '30d' ? 720 : 2160;
      const now = Math.floor(Date.now() / 1000);
      const from = now - timeframeHours * 60 * 60;

      // Fetch history for all SLOs (limit to first 10 for performance)
      const slosToAnalyze = slos.slice(0, 10);
      const historyResults = await Promise.all(
        slosToAnalyze.map(async slo => {
          if (!slo.id) return null;
          try {
            const historyResult = await sendServiceRequest('datadog', {
              endpoint: `/api/v1/slo/${slo.id}/history`,
              method: 'GET',
              params: {
                from_ts: `${from}`,
                to_ts: `${now}`,
              },
              env: datadogEnv as ServiceEnv | undefined,
            });
            return { sloId: slo.id, history: historyResult };
          } catch {
            return { sloId: slo.id, error: 'Failed to fetch history' };
          }
        }),
      );

      // Process results
      interface SLOStatus {
        id: string;
        name: string;
        description?: string;
        tags?: string[];
        target: number;
        timeframe: string;
        sliValue?: number;
        errorBudgetRemaining?: number;
        errorBudgetRemainingPercent?: number;
        status: 'healthy' | 'warning' | 'critical' | 'unknown';
        statusReason: string;
      }

      const sloStatuses: SLOStatus[] = [];

      for (const slo of slosToAnalyze) {
        if (!slo.id) continue;

        const historyData = historyResults.find(h => h?.sloId === slo.id);
        const threshold = slo.thresholds?.find(t => t.timeframe === tf) || slo.thresholds?.[0];
        const target = threshold?.target || 99.9;
        const warning = threshold?.warning || target - 0.1;

        const sloStatus: SLOStatus = {
          id: slo.id,
          name: slo.name || 'Unknown',
          description: slo.description,
          tags: slo.tags,
          target,
          timeframe: threshold?.timeframe || tf,
          status: 'unknown',
          statusReason: 'Unable to fetch SLO data',
        };

        if (historyData && !('error' in historyData)) {
          const history = historyData.history as {
            data?: {
              overall?: {
                sli_value?: number;
                error_budget_remaining?: {
                  value?: number;
                  unit?: string;
                };
              };
            };
          };

          const overall = history.data?.overall;
          if (overall) {
            sloStatus.sliValue = overall.sli_value;
            sloStatus.errorBudgetRemaining = overall.error_budget_remaining?.value;

            // Calculate error budget remaining as percentage
            const errorBudgetTotal = 100 - target;
            if (errorBudgetTotal > 0 && sloStatus.errorBudgetRemaining !== undefined) {
              sloStatus.errorBudgetRemainingPercent =
                Math.round((sloStatus.errorBudgetRemaining / errorBudgetTotal) * 10000) / 100;
            }

            // Determine status
            if (sloStatus.sliValue !== undefined) {
              if (sloStatus.sliValue >= target) {
                sloStatus.status = 'healthy';
                sloStatus.statusReason = `SLI (${sloStatus.sliValue?.toFixed(3)}%) meets target (${target}%)`;
              } else if (sloStatus.sliValue >= warning) {
                sloStatus.status = 'warning';
                sloStatus.statusReason = `SLI (${sloStatus.sliValue?.toFixed(3)}%) below target (${target}%), above warning (${warning}%)`;
              } else {
                sloStatus.status = 'critical';
                sloStatus.statusReason = `SLI (${sloStatus.sliValue?.toFixed(3)}%) below warning threshold (${warning}%)`;
              }
            }

            // Override based on error budget
            if (sloStatus.errorBudgetRemainingPercent !== undefined) {
              if (sloStatus.errorBudgetRemainingPercent <= 0) {
                sloStatus.status = 'critical';
                sloStatus.statusReason = 'Error budget exhausted!';
              } else if (sloStatus.errorBudgetRemainingPercent < 20) {
                if (sloStatus.status !== 'critical') {
                  sloStatus.status = 'warning';
                  sloStatus.statusReason = `Error budget low: ${sloStatus.errorBudgetRemainingPercent.toFixed(1)}% remaining`;
                }
              }
            }
          }
        }

        sloStatuses.push(sloStatus);
      }

      // Sort by status (critical first, then warning, then healthy)
      const statusOrder = { critical: 0, warning: 1, healthy: 2, unknown: 3 };
      sloStatuses.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

      // Summary
      const criticalCount = sloStatuses.filter(s => s.status === 'critical').length;
      const warningCount = sloStatuses.filter(s => s.status === 'warning').length;
      const healthyCount = sloStatuses.filter(s => s.status === 'healthy').length;

      return success({
        timeframe: tf,
        summary: {
          total: sloStatuses.length,
          critical: criticalCount,
          warning: warningCount,
          healthy: healthyCount,
          overallStatus: criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy',
        },
        slos: sloStatuses.map(s => ({
          ...s,
          datadogUrl: `https://app.datadoghq.com/slo?slo_id=${s.id}`,
        })),
        note:
          slos.length > 10
            ? `Showing 10 of ${slos.length} matching SLOs. Add more specific filters to narrow results.`
            : undefined,
      });
    },
  );

  return tools;
};
