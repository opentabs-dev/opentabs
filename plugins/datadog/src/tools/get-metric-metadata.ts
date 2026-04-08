import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { metricMetadataSchema, mapMetricMetadata } from './schemas.js';

export const getMetricMetadata = defineTool({
  name: 'get_metric_metadata',
  displayName: 'Get Metric Metadata',
  description: 'Get metadata for a specific metric including type, description, unit, and integration name.',
  summary: 'Get metric description, type, and unit info',
  icon: 'info',
  group: 'Metrics',
  input: z.object({
    metric_name: z.string().describe('Full metric name (e.g., "system.cpu.user", "aws.ec2.cpuutilization")'),
  }),
  output: z.object({
    metadata: metricMetadataSchema,
  }),
  handle: async params => {
    const data = await apiGet<Record<string, unknown>>(`/api/v1/metrics/${params.metric_name}`);
    return { metadata: mapMetricMetadata(data) };
  },
});
