import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchItem } from '../hackernews-api.js';
import { itemSchema, mapItem } from './schemas.js';

export const getItem = defineTool({
  name: 'get_item',
  displayName: 'Get Item',
  description:
    'Get a Hacker News item by its ID. Items include stories, comments, and jobs. Returns the full item with title, URL, text, score, author, and comment count.',
  summary: 'Get a story, comment, or job by ID',
  icon: 'file-text',
  group: 'Items',
  input: z.object({
    id: z.number().int().min(1).describe('Item ID'),
  }),
  output: z.object({ item: itemSchema }),
  handle: async params => {
    const data = await fetchItem(params.id);
    return { item: mapItem(data) };
  },
});
