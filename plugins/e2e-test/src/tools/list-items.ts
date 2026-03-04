import { testApi } from '../test-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const listItems = defineTool({
  name: 'list_items',
  displayName: 'List Items',
  description:
    "List items from the test server with optional pagination — mirrors patterns like Slack's conversations.list",
  summary: 'List items with pagination',
  icon: 'wrench',
  group: 'Data',
  input: z.object({
    limit: z.number().optional().describe('Maximum number of items to return (default 10, max 100)'),
    offset: z.number().optional().describe('Offset for pagination (default 0)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request succeeded'),
    items: z
      .array(
        z.object({
          id: z.string().describe('Unique item identifier'),
          name: z.string().describe('Item name'),
        }),
      )
      .describe('Array of items'),
    total: z.number().describe('Total number of items available'),
  }),
  handle: async params => {
    const data = await testApi<{
      items: Array<{ id: string; name: string }>;
      total: number;
    }>('/api/list-items', {
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    return { ok: data.ok, items: data.items, total: data.total };
  },
});
