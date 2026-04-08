import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { notebookSchema, mapNotebook } from './schemas.js';

export const searchNotebooks = defineTool({
  name: 'search_notebooks',
  displayName: 'Search Notebooks',
  description: 'Search Datadog notebooks by name. Returns matching notebooks sorted by modification time.',
  summary: 'Search notebooks by name',
  icon: 'search',
  group: 'Notebooks',
  input: z.object({
    query: z.string().describe('Search text to match against notebook names'),
    count: z.number().int().min(1).max(100).optional().describe('Maximum results (default 25)'),
  }),
  output: z.object({
    notebooks: z.array(notebookSchema),
    total: z.number().describe('Total matching notebooks'),
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>>; meta?: { total?: number } }>(
      '/api/v1/notebooks',
      {
        query: params.query,
        count: params.count ?? 25,
        sort_field: 'modified',
        sort_dir: 'desc',
      },
    );
    return {
      notebooks: (data.data ?? []).map(mapNotebook),
      total: data.meta?.total ?? 0,
    };
  },
});
