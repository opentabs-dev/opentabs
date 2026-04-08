import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

const resultSchema = z.object({
  result_id: z.string().describe('Result ID'),
  status: z.number().describe('Result status (0=passed, non-0=failed)'),
  check_time: z.number().describe('Check time (epoch ms)'),
  duration: z.number().describe('Duration in ms'),
  dc_id: z.number().describe('Datacenter ID'),
});

export const getSyntheticsResults = defineTool({
  name: 'get_synthetics_results',
  displayName: 'Get Synthetics Results',
  description: 'Get recent execution results for a synthetic test.',
  summary: 'Get recent synthetic test results',
  icon: 'check-circle',
  group: 'Synthetics',
  input: z.object({
    public_id: z.string().describe('Synthetic test public ID'),
  }),
  output: z.object({
    results: z.array(resultSchema),
  }),
  handle: async params => {
    const data = await apiGet<{ results?: Array<Record<string, unknown>> }>(
      `/api/v1/synthetics/tests/${params.public_id}/results`,
    );
    const results = (data.results ?? []).map(r => ({
      result_id: (r.result_id as string) ?? '',
      status: (r.status as number) ?? 0,
      check_time: (r.check_time as number) ?? 0,
      duration: (r.duration as number) ?? 0,
      dc_id: (r.dc_id as number) ?? 0,
    }));
    return { results };
  },
});
