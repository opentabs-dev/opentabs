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

interface RunRealtimeReportResponse {
  dimensionHeaders?: RawReportHeader[];
  metricHeaders?: RawReportHeader[];
  rows?: RawReportRow[];
  rowCount?: number;
}

export const runRealtimeReport = defineTool({
  name: 'run_realtime_report',
  displayName: 'Run Realtime Report',
  description:
    'Run a realtime analytics report showing data from the last 30 minutes. Useful for monitoring live traffic, active users, current page views, and event activity. Common realtime dimensions: "country", "city", "unifiedScreenName", "eventName", "platform", "deviceCategory". Common realtime metrics: "activeUsers", "eventCount", "screenPageViews", "conversions". Not all standard dimensions/metrics are available in realtime — use get_metadata with the property ID to check availability.',
  summary: 'Get realtime analytics data (last 30 minutes)',
  icon: 'activity',
  group: 'Reporting',
  input: z.object({
    property_id: z.string().describe('GA4 property ID (numeric string)'),
    dimensions: z
      .array(z.string())
      .optional()
      .describe('Realtime dimension API names (e.g., ["country", "unifiedScreenName"])'),
    metrics: z
      .array(z.string())
      .describe('Realtime metric API names (e.g., ["activeUsers", "eventCount"]). At least 1 required.'),
    dimension_filter: z.string().optional().describe('JSON string of a dimension filter object for realtime data'),
    metric_filter: z.string().optional().describe('JSON string of a metric filter object for realtime data'),
    limit: z.number().int().min(1).max(10000).optional().describe('Max rows to return (default 100)'),
  }),
  output: z.object({
    dimension_headers: z.array(reportHeaderSchema).describe('Names of dimensions in result rows'),
    metric_headers: z.array(reportHeaderSchema).describe('Names of metrics in result rows'),
    rows: z.array(reportRowSchema).describe('Realtime data rows'),
    row_count: z.number().describe('Total number of rows'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      metrics: params.metrics.map(name => ({ name })),
      limit: String(params.limit ?? 100),
    };

    if (params.dimensions?.length) {
      body.dimensions = params.dimensions.map(name => ({ name }));
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

    const data = await dataApi<RunRealtimeReportResponse>(`/properties/${params.property_id}:runRealtimeReport`, body);

    return {
      dimension_headers: (data.dimensionHeaders ?? []).map(mapReportHeader),
      metric_headers: (data.metricHeaders ?? []).map(mapReportHeader),
      rows: (data.rows ?? []).map(mapReportRow),
      row_count: data.rowCount ?? 0,
    };
  },
});
