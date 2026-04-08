import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { syntheticTestSchema, mapSyntheticTest } from './schemas.js';

export const listSyntheticsTests = defineTool({
  name: 'list_synthetics_tests',
  displayName: 'List Synthetics Tests',
  description: 'List synthetic monitoring tests (API, browser, mobile). Supports filtering by page size.',
  summary: 'List synthetic monitoring tests',
  icon: 'zap',
  group: 'Synthetics',
  input: z.object({
    page_size: z.number().int().min(1).max(100).optional().describe('Results per page (default 25)'),
    page_number: z.number().int().min(0).optional().describe('Page number (default 0)'),
  }),
  output: z.object({
    tests: z.array(syntheticTestSchema),
  }),
  handle: async params => {
    const data = await apiGet<{ tests?: Array<Record<string, unknown>> }>('/api/v1/synthetics/tests', {
      page_size: params.page_size ?? 25,
      page_number: params.page_number ?? 0,
    });
    return { tests: (data.tests ?? []).map(mapSyntheticTest) };
  },
});
