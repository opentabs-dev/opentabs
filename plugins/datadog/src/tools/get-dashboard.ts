import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

const widgetSchema = z.object({
  id: z.number().optional().describe('Widget ID'),
  title: z.string().describe('Widget title'),
  type: z.string().describe('Widget type (timeseries, toplist, query_value, etc.)'),
});

export const getDashboard = defineTool({
  name: 'get_dashboard',
  displayName: 'Get Dashboard',
  description: 'Get full details of a Datadog dashboard by ID, including its widgets, layout, and template variables.',
  summary: 'Get a dashboard by ID',
  icon: 'layout',
  group: 'Dashboards',
  input: z.object({
    dashboard_id: z.string().describe('Dashboard ID (e.g., "abc-def-ghi")'),
  }),
  output: z.object({
    id: z.string().describe('Dashboard ID'),
    title: z.string().describe('Dashboard title'),
    description: z.string().describe('Dashboard description'),
    layout_type: z.string().describe('Layout type (ordered or free)'),
    widgets: z.array(widgetSchema).describe('Dashboard widgets'),
    template_variables: z
      .array(z.object({ name: z.string(), default: z.string(), prefix: z.string() }))
      .describe('Template variables'),
    author_handle: z.string().describe('Author email handle'),
    created_at: z.string().describe('Creation timestamp'),
    modified_at: z.string().describe('Last modification timestamp'),
    url: z.string().describe('Dashboard URL path'),
  }),
  handle: async params => {
    const data = await apiGet<Record<string, unknown>>(`/api/v1/dashboard/${params.dashboard_id}`);
    const widgets = ((data.widgets as Array<Record<string, unknown>>) ?? []).map(w => {
      const def = (w.definition as Record<string, unknown>) ?? {};
      return {
        id: w.id as number | undefined,
        title: (def.title as string) ?? '',
        type: (def.type as string) ?? '',
      };
    });
    const tvars = ((data.template_variables as Array<Record<string, string>>) ?? []).map(tv => ({
      name: tv.name ?? '',
      default: tv.default ?? '',
      prefix: tv.prefix ?? '',
    }));
    return {
      id: (data.id as string) ?? '',
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
      layout_type: (data.layout_type as string) ?? '',
      widgets,
      template_variables: tvars,
      author_handle: (data.author_handle as string) ?? '',
      created_at: (data.created_at as string) ?? '',
      modified_at: (data.modified_at as string) ?? '',
      url: (data.url as string) ?? '',
    };
  },
});
