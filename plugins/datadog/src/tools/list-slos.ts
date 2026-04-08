import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { sloSchema, mapSlo } from './schemas.js';

export const listSlos = defineTool({
  name: 'list_slos',
  displayName: 'List SLOs',
  description: 'List Service Level Objectives (SLOs) in the Datadog organization with optional tag filtering.',
  summary: 'List Datadog SLOs',
  icon: 'target',
  group: 'SLOs',
  input: z.object({
    tags: z.string().optional().describe('Comma-separated tags to filter (e.g., "env:prod,team:backend")'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum results (default 25)'),
    offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
  }),
  output: z.object({
    slos: z.array(sloSchema),
    total: z.number().describe('Total number of matching SLOs'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
      offset: params.offset ?? 0,
    };
    if (params.tags) query.tags_filter = params.tags;

    const data = await apiGet<{ data?: Array<Record<string, unknown>>; metadata?: { total_count?: number } }>(
      '/api/v1/slo',
      query,
    );
    return {
      slos: (data.data ?? []).map(mapSlo),
      total: data.metadata?.total_count ?? 0,
    };
  },
});
