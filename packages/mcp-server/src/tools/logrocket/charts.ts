import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerLogrocketChartTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List charts
  define(
    'logrocket_list_charts',
    {
      description: `List custom metric charts in a LogRocket application.

Charts track metrics like:
- Page load times
- Error rates
- Custom events
- Conversion funnels
- Network request performance`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/charts/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // Get chart details
  define(
    'logrocket_get_chart',
    {
      description: `Get the full configuration of a specific LogRocket chart.

Returns:
- Chart name, type (CHART, TABLE, FUNNEL, HEATMAP, PATH), and grouping
- Aggregation settings (percentile, count, average)
- Applied filters and compound filters (network requests, page visits, clicks)
- Alert configurations attached to the chart
- Dashboard memberships (which dashboards include this chart)
- Time range and comparison settings

Use chart IDs from logrocket_list_charts or logrocket_get_dashboard results.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        chartId: z.string().describe('Chart ID'),
      },
    },
    async ({ orgSlug, appSlug, chartId }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/charts/${chartId}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // List dashboards
  define(
    'logrocket_list_dashboards',
    {
      description: `List dashboards in a LogRocket application. Each dashboard groups related charts for a feature or workflow.

Returns for each dashboard:
- Dashboard name, ID, and owner
- Full list of charts with their names, types (CHART, TABLE, FUNNEL, HEATMAP, SESSION, PATH), and grid layout positions
- Privacy settings

Use dashboard IDs with logrocket_get_dashboard for full details, or use chart IDs directly with logrocket_get_chart.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/dashboards/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // Get dashboard details
  define(
    'logrocket_get_dashboard',
    {
      description: `Get a specific LogRocket dashboard with its full chart listing and grid layout.

Returns:
- Dashboard name, owner, and modification date
- Complete chart list with names, types, and grid positions (x, y, width, height)
- Maximum chart capacity

Use this to understand what metrics a team is tracking for a specific feature area. Chart IDs from the response can be used with logrocket_get_chart.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        dashboardId: z.string().describe('Dashboard ID'),
      },
    },
    async ({ orgSlug, appSlug, dashboardId }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/dashboards/${dashboardId}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  return tools;
};
