import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';

export const removeLabel = defineTool({
  name: 'remove_label',
  displayName: 'Remove Label',
  description: 'Remove a label from a Confluence page. Requires the label ID (use list_labels to find it).',
  summary: 'Remove a label from a page',
  icon: 'tag',
  group: 'Labels',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to remove the label from'),
    label_id: z.string().min(1).describe('Label ID to remove (use list_labels to find label IDs)'),
  }),
  output: z.object({
    removed: z.boolean().describe('Whether the label was removed'),
  }),
  handle: async params => {
    await apiV2<unknown>(`/pages/${params.page_id}/labels/${params.label_id}`, {
      method: 'DELETE',
    });
    return { removed: true };
  },
});
