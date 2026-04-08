import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { sloSchema, mapSlo } from './schemas.js';

export const searchSlos = defineTool({
  name: 'search_slos',
  displayName: 'Search SLOs',
  description: 'Search SLOs by name using substring matching.',
  summary: 'Search SLOs by name',
  icon: 'search',
  group: 'SLOs',
  input: z.object({
    query: z.string().describe('Search text to match against SLO names'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum results'),
  }),
  output: z.object({
    slos: z.array(sloSchema),
    total: z.number(),
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>>; metadata?: { total_count?: number } }>(
      '/api/v1/slo',
      { query: params.query, limit: params.limit ?? 25 },
    );
    return {
      slos: (data.data ?? []).map(mapSlo),
      total: data.metadata?.total_count ?? 0,
    };
  },
});
