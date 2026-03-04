import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV1 } from '../confluence-api.js';
import { type RawLabel, labelSchema, mapLabel } from './schemas.js';

export const addLabel = defineTool({
  name: 'add_label',
  displayName: 'Add Label',
  description: 'Add a label to a Confluence page',
  summary: 'Add a label to a page',
  icon: 'tag',
  group: 'Labels',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to add the label to'),
    label: z.string().min(1).describe('Label name to add (e.g., "meeting-notes")'),
  }),
  output: z.object({
    labels: z.array(labelSchema).describe('All labels on the page after adding'),
  }),
  handle: async params => {
    const data = await apiV1<{
      results: RawLabel[];
    }>(`/content/${params.page_id}/label`, {
      method: 'POST',
      body: [{ prefix: 'global', name: params.label }],
    });

    return {
      labels: (data.results ?? []).map(mapLabel),
    };
  },
});
