import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { dataApi } from '../ga-api.js';
import {
  reportRowSchema,
  reportHeaderSchema,
  mapReportRow,
  mapReportHeader,
  type RawReportRow,
  type RawReportHeader,
} from './schemas.js';

interface RunReportResponse {
  dimensionHeaders?: RawReportHeader[];
  metricHeaders?: RawReportHeader[];
  rows?: RawReportRow[];
  rowCount?: number;
  metadata?: { currencyCode?: string; timeZone?: string };
}

export const runReport = defineTool({
  name: 'run_report',
  displayName: 'Run Report',
  description:
    'Run a GA4 analytics report with specified dimensions, metrics, and date ranges. This is the primary reporting tool — supports all 374+ dimensions and 86+ metrics. Use get_metadata to discover available fields, and check_compatibility to verify combinations work together. Common dimensions: "country", "city", "pagePath", "sessionSource", "deviceCategory", "browser". Common metrics: "activeUsers", "sessions", "screenPageViews", "bounceRate", "averageSessionDuration", "conversions". Date formats: "YYYY-MM-DD", "today", "yesterday", "NdaysAgo" (e.g., "7daysAgo"). Returns up to 10000 rows per request; use offset for pagination.',
  summary: 'Run a GA4 analytics report',
  icon: 'bar-chart-3',
  group: 'Reporting',
  input: z.object({
    property_id: z.string().describe('GA4 property ID (numeric string)'),
    dimensions: z
      .array(z.string())
      .optional()
      .describe('Dimension API names to include (e.g., ["country", "pagePath"]). Max 9 dimensions per report.'),
    metrics: z
      .array(z.string())
      .describe('Metric API names to include (e.g., ["activeUsers", "sessions"]). At least 1 required.'),
    start_date: z.string().describe('Start date (YYYY-MM-DD, "today", "yesterday", or "NdaysAgo")'),
    end_date: z.string().describe('End date (YYYY-MM-DD, "today", "yesterday", or "NdaysAgo")'),
    dimension_filter: z
      .string()
      .optional()
      .describe(
        'JSON string of a dimension filter object. Example: {"filter":{"fieldName":"country","stringFilter":{"value":"United States"}}}',
      ),
    metric_filter: z
      .string()
      .optional()
      .describe(
        'JSON string of a metric filter object. Example: {"filter":{"fieldName":"activeUsers","numericFilter":{"operation":"GREATER_THAN","value":{"int64Value":"100"}}}}',
      ),
    order_by: z
      .string()
      .optional()
      .describe('JSON string of orderBys array. Example: [{"metric":{"metricName":"activeUsers"},"desc":true}]'),
    limit: z.number().int().min(1).max(10000).optional().describe('Max rows to return (default 100, max 10000)'),
    offset: z.number().int().min(0).optional().describe('Row offset for pagination (default 0)'),
  }),
  output: z.object({
    dimension_headers: z.array(reportHeaderSchema).describe('Names of dimensions in result rows'),
    metric_headers: z.array(reportHeaderSchema).describe('Names of metrics in result rows'),
    rows: z.array(reportRowSchema).describe('Report data rows'),
    row_count: z.number().describe('Total number of rows matching the query (may exceed returned rows if paginated)'),
    currency_code: z.string().describe('Currency code for monetary metrics'),
    time_zone: z.string().describe('Property time zone'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      dateRanges: [{ startDate: params.start_date, endDate: params.end_date }],
      metrics: params.metrics.map(name => ({ name })),
      limit: String(params.limit ?? 100),
    };

    if (params.dimensions?.length) {
      body.dimensions = params.dimensions.map(name => ({ name }));
    }
    if (params.offset !== undefined) {
      body.offset = String(params.offset);
    }
    if (params.dimension_filter) {
      try {
        body.dimensionFilter = JSON.parse(params.dimension_filter);
      } catch {
        throw ToolError.validation('dimension_filter must be valid JSON');
      }
    }
    if (params.metric_filter) {
      try {
        body.metricFilter = JSON.parse(params.metric_filter);
      } catch {
        throw ToolError.validation('metric_filter must be valid JSON');
      }
    }
    if (params.order_by) {
      try {
        body.orderBys = JSON.parse(params.order_by);
      } catch {
        throw ToolError.validation('order_by must be valid JSON');
      }
    }

    const data = await dataApi<RunReportResponse>(`/properties/${params.property_id}:runReport`, body);

    return {
      dimension_headers: (data.dimensionHeaders ?? []).map(mapReportHeader),
      metric_headers: (data.metricHeaders ?? []).map(mapReportHeader),
      rows: (data.rows ?? []).map(mapReportRow),
      row_count: data.rowCount ?? 0,
      currency_code: data.metadata?.currencyCode ?? '',
      time_zone: data.metadata?.timeZone ?? '',
    };
  },
});
