import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const triggerSyntheticsTest = defineTool({
  name: 'trigger_synthetics_test',
  displayName: 'Trigger Synthetics Test',
  description: 'Trigger an on-demand run of a synthetic test. Returns the triggered results with batch ID.',
  summary: 'Trigger a synthetic test run',
  icon: 'play',
  group: 'Synthetics',
  input: z.object({
    public_ids: z.array(z.string()).min(1).describe('Array of synthetic test public IDs to trigger'),
  }),
  output: z.object({
    batch_id: z.string().describe('Batch ID for tracking results'),
    triggered_check_ids: z.array(z.string()).describe('IDs of triggered checks'),
  }),
  handle: async params => {
    const data = await apiPost<{
      batch_id?: string;
      triggered_check_ids?: string[];
      results?: Array<{ result_id?: string; public_id?: string }>;
    }>('/api/v1/synthetics/tests/trigger', { tests: params.public_ids.map(id => ({ public_id: id })) });
    return {
      batch_id: data.batch_id ?? '',
      triggered_check_ids: data.triggered_check_ids ?? (data.results ?? []).map(r => r.public_id ?? ''),
    };
  },
});
