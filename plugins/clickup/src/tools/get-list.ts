import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../clickup-api.js';
import { listSchema, mapList } from './schemas.js';

export const getList = defineTool({
  name: 'get_list',
  displayName: 'Get List',
  description:
    'Get detailed information about a specific ClickUp list by its ID. Returns list name, order, archive status, dates, and parent folder/space.',
  summary: 'Get list details by ID',
  icon: 'list-checks',
  group: 'Lists',
  input: z.object({
    list_id: z.string().min(1).describe('List ID'),
  }),
  output: z.object({ list: listSchema.describe('List details') }),
  handle: async params => {
    const data = await api<Record<string, unknown>>(`/hierarchy/v1/subcategory/${params.list_id}`);
    return { list: mapList(data) };
  },
});
