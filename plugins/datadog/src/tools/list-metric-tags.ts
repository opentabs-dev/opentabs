import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const listMetricTags = defineTool({
  name: 'list_metric_tags',
  displayName: 'List Metric Tags',
  description:
    'List all tags associated with a specific metric. Useful for understanding available dimensions for filtering and grouping.',
  summary: 'List tags for a metric',
  icon: 'tag',
  group: 'Metrics',
  input: z.object({
    metric_name: z.string().describe('Metric name to get tags for (e.g., "system.cpu.user")'),
  }),
  output: z.object({
    tags: z.array(z.string()).describe('Available tags for the metric'),
  }),
  handle: async params => {
    const data = await apiGet<{ tags?: string[] }>(`/api/ui/metrics/all-tags/${params.metric_name}`);
    return { tags: data.tags ?? [] };
  },
});
