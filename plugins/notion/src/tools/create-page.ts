import { mapPage, pageSchema } from './schemas.js';
import { getSpaceId, getUserId, notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const createPage = defineTool({
  name: 'create_page',
  displayName: 'Create Page',
  description:
    'Create a new page in the Notion workspace. The page is created at the top level of the workspace by default, or as a child of an existing page.',
  summary: 'Create a new page',
  icon: 'file-plus',
  group: 'Pages',
  input: z.object({
    title: z.string().min(1).describe('Page title'),
    parent_page_id: z
      .string()
      .optional()
      .describe('Parent page ID to create as a child page. If omitted, creates at the workspace top level.'),
    icon: z.string().optional().describe('Page icon (emoji character, e.g., "📝")'),
    content: z.string().optional().describe('Initial text content to add to the page body'),
  }),
  output: z.object({
    page: pageSchema.describe('The created page'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const userId = getUserId();
    const pageId = crypto.randomUUID();
    const now = Date.now();

    const parentId = params.parent_page_id ?? spaceId;
    const parentTable = params.parent_page_id ? 'block' : 'space';

    const operations: Record<string, unknown>[] = [
      // Create the page block
      {
        pointer: { table: 'block', id: pageId, spaceId },
        command: 'set',
        path: [],
        args: {
          type: 'page',
          id: pageId,
          version: 1,
          parent_id: parentId,
          parent_table: parentTable,
          alive: true,
          created_time: now,
          created_by_id: userId,
          created_by_table: 'notion_user',
          last_edited_time: now,
          last_edited_by_id: userId,
          last_edited_by_table: 'notion_user',
          space_id: spaceId,
          permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }],
        },
      },
      // Set title
      {
        pointer: { table: 'block', id: pageId, spaceId },
        command: 'update',
        path: ['properties', 'title'],
        args: [[params.title]],
      },
      // Add to parent's content/pages list
      {
        pointer: { table: parentTable, id: parentId, spaceId },
        command: 'listAfter',
        path: [parentTable === 'space' ? 'pages' : 'content'],
        args: { id: pageId },
      },
    ];

    // Set icon if provided
    if (params.icon) {
      operations.push({
        pointer: { table: 'block', id: pageId, spaceId },
        command: 'update',
        path: ['format', 'page_icon'],
        args: params.icon,
      });
    }

    // Add initial text content if provided
    if (params.content) {
      const textBlockId = crypto.randomUUID();
      operations.push(
        {
          pointer: { table: 'block', id: textBlockId, spaceId },
          command: 'set',
          path: [],
          args: {
            type: 'text',
            id: textBlockId,
            version: 1,
            parent_id: pageId,
            parent_table: 'block',
            alive: true,
            created_time: now,
            created_by_id: userId,
            created_by_table: 'notion_user',
            last_edited_time: now,
            last_edited_by_id: userId,
            last_edited_by_table: 'notion_user',
            space_id: spaceId,
            properties: { title: [[params.content]] },
          },
        },
        {
          pointer: { table: 'block', id: pageId, spaceId },
          command: 'listAfter',
          path: ['content'],
          args: { id: textBlockId },
        },
      );
    }

    await notionApi('submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [{ id: crypto.randomUUID(), spaceId, operations }],
    });

    // Fetch the created page to return it
    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: pageId, table: 'block' }],
    });

    const pageData = result.results?.[0]?.value;
    return { page: mapPage(pageData as Record<string, unknown> | undefined) };
  },
});
