import { mapPage, pageSchema } from './schemas.js';
import { getSpaceId, getUserId, notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const updatePage = defineTool({
  name: 'update_page',
  displayName: 'Update Page',
  description: 'Update a page title, icon, or cover image in Notion',
  summary: "Update a page's title, icon, or cover",
  icon: 'pencil',
  group: 'Pages',
  input: z.object({
    page_id: z.string().describe('Page ID (UUID) to update'),
    title: z.string().optional().describe('New page title'),
    icon: z.string().optional().describe('New page icon (emoji character, e.g., "📝")'),
    cover: z.string().optional().describe('New page cover image path'),
  }),
  output: z.object({
    page: pageSchema.describe('The updated page'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const userId = getUserId();
    const now = Date.now();

    const operations: Record<string, unknown>[] = [];

    if (params.title !== undefined) {
      operations.push({
        pointer: { table: 'block', id: params.page_id, spaceId },
        command: 'update',
        path: ['properties', 'title'],
        args: [[params.title]],
      });
    }

    if (params.icon !== undefined) {
      operations.push({
        pointer: { table: 'block', id: params.page_id, spaceId },
        command: 'update',
        path: ['format', 'page_icon'],
        args: params.icon,
      });
    }

    if (params.cover !== undefined) {
      operations.push({
        pointer: { table: 'block', id: params.page_id, spaceId },
        command: 'update',
        path: ['format', 'page_cover'],
        args: params.cover,
      });
    }

    // Always update last_edited metadata
    operations.push({
      pointer: { table: 'block', id: params.page_id, spaceId },
      command: 'update',
      path: [],
      args: {
        last_edited_time: now,
        last_edited_by_id: userId,
        last_edited_by_table: 'notion_user',
      },
    });

    await notionApi('submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [{ id: crypto.randomUUID(), spaceId, operations }],
    });

    // Fetch the updated page
    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.page_id, table: 'block' }],
    });

    const pageData = result.results?.[0]?.value;
    return { page: mapPage(pageData as Record<string, unknown> | undefined) };
  },
});
