import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { notebookSchema, mapNotebook } from './schemas.js';

export const getNotebook = defineTool({
  name: 'get_notebook',
  displayName: 'Get Notebook',
  description: 'Get full details of a Datadog notebook by ID, including its cells and metadata.',
  summary: 'Get a notebook by ID',
  icon: 'book-open',
  group: 'Notebooks',
  input: z.object({
    notebook_id: z.number().int().describe('Notebook ID'),
  }),
  output: z.object({
    notebook: notebookSchema,
    cells: z.array(
      z.object({
        type: z.string().describe('Cell type (markdown, timeseries, log_stream, etc.)'),
        content: z.unknown().describe('Cell content'),
      }),
    ),
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Record<string, unknown> }>(`/api/v1/notebooks/${params.notebook_id}`);
    const nb = data.data ?? {};
    const attrs = (nb.attributes as Record<string, unknown>) ?? {};
    const rawCells = (attrs.cells as Array<Record<string, unknown>>) ?? [];
    const cells = rawCells.map(c => ({
      type: (c.type as string) ?? '',
      content: c.attributes ?? c,
    }));
    return { notebook: mapNotebook(nb), cells };
  },
});
