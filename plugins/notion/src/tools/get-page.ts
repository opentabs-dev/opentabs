import { blockSchema, mapBlock, mapPage, pageSchema } from './schemas.js';
import { notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface LoadPageChunkResponse {
  recordMap: {
    block?: Record<string, { value?: Record<string, unknown> }>;
    collection?: Record<string, { value?: Record<string, unknown> }>;
  };
}

export const getPage = defineTool({
  name: 'get_page',
  displayName: 'Get Page',
  description:
    'Get a Notion page by ID, including its title, metadata, and content blocks. Returns the page info and its direct child blocks.',
  summary: 'Get a page with its content',
  icon: 'file-text',
  group: 'Pages',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID (UUID format, e.g., "f4ab7079-036d-4893-aaa3-6440d973a22f")'),
  }),
  output: z.object({
    page: pageSchema.describe('Page metadata'),
    blocks: z.array(blockSchema).describe('Direct child content blocks'),
  }),
  handle: async params => {
    const data = await notionApi<LoadPageChunkResponse>('loadPageChunk', {
      pageId: params.page_id,
      limit: 100,
      cursor: { stack: [] },
      chunkNumber: 0,
      verticalColumns: false,
    });

    const blockMap = data.recordMap?.block ?? {};
    const pageBlockData = blockMap[params.page_id]?.value;
    const page = mapPage(pageBlockData as Record<string, unknown> | undefined);

    // Get child block IDs from the page's content array
    const contentIds = (pageBlockData?.content as string[] | undefined) ?? [];
    const blocks = contentIds.map(id => {
      const blockData = blockMap[id]?.value;
      return mapBlock(blockData as Record<string, unknown> | undefined);
    });

    return { page, blocks };
  },
});
