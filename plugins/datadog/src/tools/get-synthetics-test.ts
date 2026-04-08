import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { syntheticTestSchema, mapSyntheticTest } from './schemas.js';

export const getSyntheticsTest = defineTool({
  name: 'get_synthetics_test',
  displayName: 'Get Synthetics Test',
  description: 'Get detailed information about a specific synthetic test by public ID.',
  summary: 'Get a synthetic test by ID',
  icon: 'zap',
  group: 'Synthetics',
  input: z.object({
    public_id: z.string().describe('Synthetic test public ID (e.g., "abc-def-ghi")'),
  }),
  output: z.object({
    test: syntheticTestSchema,
    config: z.unknown().describe('Test configuration details'),
  }),
  handle: async params => {
    const data = await apiGet<Record<string, unknown>>(`/api/v1/synthetics/tests/${params.public_id}`);
    return {
      test: mapSyntheticTest(data),
      config: data.config ?? null,
    };
  },
});
