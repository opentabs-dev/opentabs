import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet, apiPost } from '../datadog-api.js';
import { dashboardSummarySchema, mapDashboardSummary } from './schemas.js';

export const cloneDashboard = defineTool({
  name: 'clone_dashboard',
  displayName: 'Clone Dashboard',
  description:
    'Clone an existing dashboard to create a copy. Optionally override the title or description. The original dashboard is not modified.',
  summary: 'Clone a dashboard with optional overrides',
  icon: 'copy',
  group: 'Dashboards',
  input: z.object({
    dashboard_id: z.string().describe('ID of the dashboard to clone (e.g., "abc-def-ghi")'),
    title: z.string().optional().describe('Title for the cloned dashboard. Defaults to "Clone of <original title>".'),
    description: z.string().optional().describe('Override the description on the clone'),
  }),
  output: z.object({
    dashboard: dashboardSummarySchema,
  }),
  handle: async params => {
    const original = await apiGet<Record<string, unknown>>(`/api/v1/dashboard/${params.dashboard_id}`);

    const cloneBody: Record<string, unknown> = {
      title: params.title ?? `Clone of ${(original.title as string) ?? 'dashboard'}`,
      description: params.description ?? original.description,
      layout_type: original.layout_type,
      widgets: original.widgets,
      template_variables: original.template_variables,
      notify_list: original.notify_list,
      reflow_type: original.reflow_type,
    };

    const created = await apiPost<Record<string, unknown>>('/api/v1/dashboard', cloneBody);
    return { dashboard: mapDashboardSummary(created) };
  },
});
