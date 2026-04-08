import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';
import { notebookSchema, mapNotebook } from './schemas.js';

export const createNotebook = defineTool({
  name: 'create_notebook',
  displayName: 'Create Notebook',
  description: 'Create a new Datadog notebook with markdown and metric cells.',
  summary: 'Create a new notebook',
  icon: 'plus',
  group: 'Notebooks',
  input: z.object({
    name: z.string().describe('Notebook title'),
    cells: z
      .array(
        z.object({
          type: z.enum(['markdown', 'timeseries', 'log_stream']).describe('Cell type'),
          content: z.string().describe('Cell content (markdown text or metric query)'),
        }),
      )
      .describe('Notebook cells'),
    time_span: z.string().optional().describe('Relative time span (e.g., "1h", "4h", "1d"). Default: "1h"'),
  }),
  output: z.object({
    notebook: notebookSchema,
  }),
  handle: async params => {
    const cells = params.cells.map(c => ({
      type: 'notebook_cells' as const,
      attributes: {
        definition:
          c.type === 'markdown'
            ? { type: 'markdown' as const, text: c.content }
            : c.type === 'timeseries'
              ? {
                  type: 'timeseries' as const,
                  requests: [{ q: c.content, display_type: 'line' }],
                }
              : { type: 'log_stream' as const, query: c.content },
      },
    }));

    const data = await apiPost<{ data?: Record<string, unknown> }>('/api/v1/notebooks', {
      data: {
        type: 'notebooks',
        attributes: {
          name: params.name,
          status: 'published',
          time: { live_span: params.time_span ?? '1h' },
          cells,
        },
      },
    });
    return { notebook: mapNotebook(data.data ?? {}) };
  },
});
