import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';

export const deletePage = defineTool({
  name: 'delete_page',
  displayName: 'Delete Page',
  description: 'Delete a Confluence page by its ID. The page is moved to trash and can be restored.',
  summary: 'Delete a page by ID',
  icon: 'file-x',
  group: 'Pages',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to delete'),
  }),
  output: z.object({
    deleted: z.boolean().describe('Whether the page was successfully deleted'),
  }),
  handle: async params => {
    await apiV2<unknown>(`/pages/${params.page_id}`, {
      method: 'DELETE',
    });
    return { deleted: true };
  },
});
