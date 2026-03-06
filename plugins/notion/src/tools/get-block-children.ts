import { blockSchema, mapBlock } from './schemas.js';
import { notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const getBlockChildren = defineTool({
  name: 'get_block_children',
  displayName: 'Get Block Children',
  description: 'Get the child blocks of a specific block or page. Useful for reading nested content.',
  summary: 'Get child blocks of a block or page',
  icon: 'list-tree',
  group: 'Blocks',
  input: z.object({
    block_id: z.string().min(1).describe('Block or page ID (UUID) to get children of'),
  }),
  output: z.object({
    children: z.array(blockSchema).describe('Child blocks'),
  }),
  handle: async params => {
    // First get the parent block to find its content IDs
    const parentData = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.block_id, table: 'block' }],
    });

    const parentBlock = parentData.results?.[0]?.value;
    const contentIds = (parentBlock?.content as string[] | undefined) ?? [];

    if (contentIds.length === 0) {
      return { children: [] };
    }

    // Fetch all child blocks
    const childData = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: contentIds.map(id => ({ id, table: 'block' })),
    });

    const children = (childData.results ?? []).map(r => mapBlock(r.value as Record<string, unknown> | undefined));

    return { children };
  },
});
