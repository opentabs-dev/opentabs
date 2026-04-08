import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPut } from '../datadog-api.js';
import { notebookSchema, mapNotebook } from './schemas.js';

export const updateNotebook = defineTool({
  name: 'update_notebook',
  displayName: 'Update Notebook',
  description: 'Update an existing Datadog notebook — change name, cells, or time span.',
  summary: 'Update a notebook',
  icon: 'edit',
  group: 'Notebooks',
  input: z.object({
    notebook_id: z.number().int().describe('Notebook ID'),
    name: z.string().optional().describe('New notebook name'),
    cells: z
      .array(
        z.object({
          type: z.enum(['markdown', 'timeseries', 'log_stream']).describe('Cell type'),
          content: z.string().describe('Cell content'),
        }),
      )
      .optional()
      .describe('Replace all cells'),
    time_span: z.string().optional().describe('Relative time span (e.g., "1h", "4h", "1d")'),
  }),
  output: z.object({
    notebook: notebookSchema,
  }),
  handle: async params => {
    const attributes: Record<string, unknown> = {};
    if (params.name) attributes.name = params.name;
    if (params.time_span) attributes.time = { live_span: params.time_span };
    if (params.cells) {
      attributes.cells = params.cells.map(c => ({
        type: 'notebook_cells',
        attributes: {
          definition:
            c.type === 'markdown'
              ? { type: 'markdown', text: c.content }
              : c.type === 'timeseries'
                ? { type: 'timeseries', requests: [{ q: c.content, display_type: 'line' }] }
                : { type: 'log_stream', query: c.content },
        },
      }));
    }

    const data = await apiPut<{ data?: Record<string, unknown> }>(`/api/v1/notebooks/${params.notebook_id}`, {
      data: {
        type: 'notebooks',
        attributes: { status: 'published', ...attributes },
      },
    });
    return { notebook: mapNotebook(data.data ?? {}) };
  },
});
