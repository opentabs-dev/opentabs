import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchStoryComments } from '../hackernews-api.js';
import { commentSchema, mapComment } from './schemas.js';

export const getStoryComments = defineTool({
  name: 'get_story_comments',
  displayName: 'Get Story Comments',
  description:
    'Get comments for a story by its ID. Returns all comments on the page with nesting depth (indent=0 for top-level, indent=1 for replies, etc.). Comments are in ranked display order. Use page for pagination.',
  summary: 'Get comments for a story',
  icon: 'messages-square',
  group: 'Items',
  input: z.object({
    story_id: z.number().int().min(1).describe('Story ID to get comments for'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    comments: z.array(commentSchema),
    total: z.number().int().describe('Total comment count on the story'),
    has_more: z.boolean().describe('Whether more comment pages are available'),
  }),
  handle: async params => {
    const { comments, total, has_more } = await fetchStoryComments(params.story_id, params.page ?? 1);
    return { comments: comments.map(mapComment), total, has_more };
  },
});
