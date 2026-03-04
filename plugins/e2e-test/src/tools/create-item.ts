import { testApi } from '../test-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const createItem = defineTool({
  name: 'create_item',
  displayName: 'Create Item',
  description:
    "Create a new item on the test server — tests write operations (similar to Slack's conversations.create)",
  summary: 'Create a new item',
  icon: 'wrench',
  group: 'Data',
  input: z.object({
    name: z.string().describe('Name for the new item'),
    description: z.string().optional().describe('Optional description for the item'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the item was created successfully'),
    item: z
      .object({
        id: z.string().describe('Unique identifier of the created item'),
        name: z.string().describe('Name of the created item'),
        description: z.string().describe('Description of the created item'),
        created_at: z.string().describe('ISO 8601 timestamp of when the item was created'),
      })
      .describe('The newly created item'),
  }),
  handle: async params => {
    const data = await testApi<{
      item: { id: string; name: string; description?: string; created_at: string };
    }>('/api/create-item', {
      name: params.name,
      description: params.description ?? '',
    });
    return {
      ok: data.ok,
      item: {
        id: data.item.id,
        name: data.item.name,
        description: data.item.description ?? '',
        created_at: data.item.created_at,
      },
    };
  },
});
