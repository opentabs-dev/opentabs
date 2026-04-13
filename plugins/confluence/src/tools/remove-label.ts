import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV1 } from '../confluence-api.js';

export const removeLabel = defineTool({
  name: 'remove_label',
  displayName: 'Remove Label',
  description:
    'Remove a label from a Confluence page by label name. Use list_labels to see which labels are on the page.',
  summary: 'Remove a label from a page',
  icon: 'tag',
  group: 'Labels',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to remove the label from'),
    label_name: z.string().min(1).describe('Label name to remove (e.g., "e2e-test")'),
  }),
  output: z.object({
    removed: z.boolean().describe('Whether the label was removed'),
  }),
  handle: async params => {
    await apiV1<unknown>(`/content/${params.page_id}/label`, {
      method: 'DELETE',
      query: { name: params.label_name },
    });
    return { removed: true };
  },
});
