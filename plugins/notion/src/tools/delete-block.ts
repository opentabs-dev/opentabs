import { getSpaceId, notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const deleteBlock = defineTool({
  name: 'delete_block',
  displayName: 'Delete Block',
  description: 'Delete a content block from a Notion page. The block and its children are removed.',
  summary: 'Delete a block from a page',
  icon: 'trash-2',
  group: 'Pages',
  input: z.object({
    block_id: z.string().min(1).describe('Block ID (UUID) to delete'),
  }),
  output: z.object({
    deleted: z.boolean().describe('Whether the block was successfully deleted'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();

    // Fetch the block to find its parent
    const blockResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.block_id, table: 'block' }],
    });

    const blockData = blockResult.results?.[0]?.value;
    if (!blockData) throw ToolError.notFound(`Block not found: ${params.block_id}`);

    const parentId = (blockData.parent_id as string) ?? '';
    if (!parentId)
      throw ToolError.internal(`Block ${params.block_id} has no parent_id — cannot remove from parent content list`);
    const parentTable = (blockData.parent_table as string) ?? 'block';

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
              path: [],
              args: { alive: false },
            },
            {
              pointer: { table: parentTable, id: parentId, spaceId },
              command: 'listRemove',
              path: ['content'],
              args: { id: params.block_id },
            },
          ],
        },
      ],
    });

    return { deleted: true };
  },
});
