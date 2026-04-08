import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPut } from '../datadog-api.js';

export const pauseSyntheticsTest = defineTool({
  name: 'pause_synthetics_test',
  displayName: 'Pause/Resume Synthetics Test',
  description: 'Pause or resume a synthetic test by changing its status.',
  summary: 'Pause or resume a synthetic test',
  icon: 'pause',
  group: 'Synthetics',
  input: z.object({
    public_id: z.string().describe('Synthetic test public ID'),
    new_status: z.enum(['live', 'paused']).describe('New status: "live" to resume, "paused" to pause'),
  }),
  output: z.object({
    success: z.boolean(),
    public_id: z.string(),
    status: z.string(),
  }),
  handle: async params => {
    await apiPut(`/api/v1/synthetics/tests/${params.public_id}/status`, { new_status: params.new_status });
    return { success: true, public_id: params.public_id, status: params.new_status };
  },
});
