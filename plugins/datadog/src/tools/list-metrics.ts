import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const listMetrics = defineTool({
  name: 'list_metrics',
  displayName: 'List Metrics',
  description: 'List metric names available in Datadog. Filter by prefix to narrow results.',
  summary: 'List available metric names',
  icon: 'list',
  group: 'Metrics',
  input: z.object({
    query: z.string().describe('Metric name prefix to filter (e.g., "system.cpu", "aws.ec2"). Use "*" for all.'),
    from: z
      .number()
      .optional()
      .describe('Only return metrics active since this POSIX epoch (seconds). Defaults to 1 hour ago.'),
  }),
  output: z.object({
    metrics: z.array(z.string()).describe('Matching metric names'),
  }),
  handle: async params => {
    const from = params.from ?? Math.floor(Date.now() / 1000) - 3600;
    const data = await apiGet<{ metrics?: string[] }>('/api/v1/metrics', { q: params.query, from });
    return { metrics: data.metrics ?? [] };
  },
});
