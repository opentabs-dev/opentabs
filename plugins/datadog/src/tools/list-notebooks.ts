import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { notebookSchema, mapNotebook } from './schemas.js';

export const listNotebooks = defineTool({
  name: 'list_notebooks',
  displayName: 'List Notebooks',
  description:
    'List Datadog notebooks with optional text search. Notebooks are collaborative documents with time-synced data widgets.',
  summary: 'List Datadog notebooks',
  icon: 'book-open',
  group: 'Notebooks',
  input: z.object({
    query: z.string().optional().describe('Text search for notebook names'),
    count: z.number().int().min(1).max(100).optional().describe('Results per page (default 25)'),
    start: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
    sort_field: z.enum(['modified', 'name']).optional().describe('Sort by field'),
    sort_dir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
  }),
  output: z.object({
    notebooks: z.array(notebookSchema),
    total: z.number().describe('Total number of notebooks'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      count: params.count ?? 25,
      start: params.start ?? 0,
      sort_field: params.sort_field ?? 'modified',
      sort_dir: params.sort_dir ?? 'desc',
    };
    if (params.query) query.query = params.query;

    const data = await apiGet<{ data?: Array<Record<string, unknown>>; meta?: { total?: number } }>(
      '/api/v1/notebooks',
      query,
    );
    return {
      notebooks: (data.data ?? []).map(mapNotebook),
      total: data.meta?.total ?? 0,
    };
  },
});
