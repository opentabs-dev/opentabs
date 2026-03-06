import { blockSchema, mapBlock } from './schemas.js';
import { getSpaceId, getUserId, notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const updateBlock = defineTool({
  name: 'update_block',
  displayName: 'Update Block',
  description: 'Update the text content of a block in a Notion page. Replaces the block text with the new content.',
  summary: "Update a block's text content",
  icon: 'edit',
  group: 'Pages',
  input: z.object({
    block_id: z.string().min(1).describe('Block ID (UUID) to update'),
    content: z.string().min(1).describe('New text content for the block'),
  }),
  output: z.object({
    block: blockSchema.describe('The updated block'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const userId = getUserId();
    const now = Date.now();

    // Verify the block exists
    const checkResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.block_id, table: 'block' }],
    });
    const blockData = checkResult.results?.[0]?.value;
    if (!blockData) throw ToolError.notFound(`Block not found: ${params.block_id}`);

    await notionApi('submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [
        {
          id: crypto.randomUUID(),
          spaceId,
          operations: [
            {
              pointer: { table: 'block', id: params.block_id, spaceId },
              command: 'update',
              path: ['properties', 'title'],
              args: [[params.content]],
            },
            {
              pointer: { table: 'block', id: params.block_id, spaceId },
              command: 'update',
              path: [],
              args: {
                last_edited_time: now,
                last_edited_by_id: userId,
                last_edited_by_table: 'notion_user',
              },
            },
          ],
        },
      ],
    });

    // Fetch the updated block
    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.block_id, table: 'block' }],
    });

    const updated = result.results?.[0]?.value;
    return { block: mapBlock(updated as Record<string, unknown> | undefined) };
  },
});
