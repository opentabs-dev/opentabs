import { getSpaceId, notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const deletePage = defineTool({
  name: 'delete_page',
  displayName: 'Delete Page',
  description: 'Archive (soft-delete) a page in Notion. The page can be restored from trash.',
  summary: 'Archive a page to trash',
  icon: 'trash-2',
  group: 'Pages',
  input: z.object({
    page_id: z.string().describe('Page ID (UUID) to delete/archive'),
  }),
  output: z.object({
    deleted: z.boolean().describe('Whether the page was successfully archived'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();

    // First get the page to find its parent
    const pageResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.page_id, table: 'block' }],
    });

    const pageData = pageResult.results?.[0]?.value;
    if (!pageData) throw ToolError.notFound(`Page not found: ${params.page_id}`);

    const parentId = (pageData.parent_id as string) ?? '';
    if (!parentId)
      throw ToolError.internal(`Page ${params.page_id} has no parent_id — cannot remove from parent content list`);
    const parentTable = (pageData.parent_table as string) ?? 'space';
    const listPath = parentTable === 'space' ? 'pages' : 'content';

    await notionApi('submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [
        {
          id: crypto.randomUUID(),
          spaceId,
          operations: [
            {
              pointer: { table: 'block', id: params.page_id, spaceId },
              command: 'update',
              path: [],
              args: { alive: false },
            },
            {
              pointer: { table: parentTable, id: parentId, spaceId },
              command: 'listRemove',
              path: [listPath],
              args: { id: params.page_id },
            },
          ],
        },
      ],
    });

    return { deleted: true };
  },
});
