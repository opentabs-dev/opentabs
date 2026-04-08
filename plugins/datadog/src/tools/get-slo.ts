import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { sloSchema, mapSlo } from './schemas.js';

export const getSlo = defineTool({
  name: 'get_slo',
  displayName: 'Get SLO',
  description: 'Get detailed information about a specific Service Level Objective (SLO) by ID.',
  summary: 'Get an SLO by ID',
  icon: 'target',
  group: 'SLOs',
  input: z.object({
    slo_id: z.string().describe('SLO ID'),
  }),
  output: z.object({
    slo: sloSchema,
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Record<string, unknown> }>(`/api/v1/slo/${params.slo_id}`);
    return { slo: mapSlo(data.data ?? {}) };
  },
});
