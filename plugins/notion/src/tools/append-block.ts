import { blockSchema, mapBlock } from './schemas.js';
import { getSpaceId, getUserId, notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

const VALID_BLOCK_TYPES = [
  'text',
  'header',
  'sub_header',
  'sub_sub_header',
  'bulleted_list',
  'numbered_list',
  'to_do',
  'toggle',
  'quote',
  'callout',
  'divider',
  'code',
] as const;

export const appendBlock = defineTool({
  name: 'append_block',
  displayName: 'Append Block',
  description:
    'Append a content block (text, heading, list item, quote, code, etc.) to a page or block. Use this to add content to existing pages.',
  summary: 'Append content to a page',
  icon: 'plus-square',
  group: 'Blocks',
  input: z.object({
    parent_id: z.string().min(1).describe('Page or block ID to append content to'),
    type: z
      .enum(VALID_BLOCK_TYPES)
      .optional()
      .describe(
        'Block type: text, header, sub_header, sub_sub_header, bulleted_list, numbered_list, to_do, toggle, quote, callout, divider, code (default: text)',
      ),
    content: z.string().min(1).describe('Text content of the block'),
    after_id: z.string().optional().describe('Block ID to insert after. If omitted, appends at the end.'),
  }),
  output: z.object({
    block: blockSchema.describe('The created block'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const userId = getUserId();
    const blockId = crypto.randomUUID();
    const now = Date.now();
    const blockType = params.type ?? 'text';

    if (blockType === 'divider' && params.content && params.content.trim() !== '') {
      throw ToolError.validation('Divider blocks should not have content');
    }

    const blockArgs: Record<string, unknown> = {
      type: blockType,
      id: blockId,
      version: 1,
      parent_id: params.parent_id,
      parent_table: 'block',
      alive: true,
      created_time: now,
      created_by_id: userId,
      created_by_table: 'notion_user',
      last_edited_time: now,
      last_edited_by_id: userId,
      last_edited_by_table: 'notion_user',
      space_id: spaceId,
    };

    // Dividers have no text content
    if (blockType !== 'divider') {
      blockArgs.properties = { title: [[params.content]] };
    }

    const listCommand: Record<string, unknown> = { id: blockId };
    if (params.after_id) {
      listCommand.after = params.after_id;
    }

    await notionApi('submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [
        {
          id: crypto.randomUUID(),
          spaceId,
          operations: [
            {
              pointer: { table: 'block', id: blockId, spaceId },
              command: 'set',
              path: [],
              args: blockArgs,
            },
            {
              pointer: { table: 'block', id: params.parent_id, spaceId },
              command: 'listAfter',
              path: ['content'],
              args: listCommand,
            },
          ],
        },
      ],
    });

    // Fetch the created block
    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: blockId, table: 'block' }],
    });

    const blockData = result.results?.[0]?.value;
    return { block: mapBlock(blockData as Record<string, unknown> | undefined) };
  },
});
