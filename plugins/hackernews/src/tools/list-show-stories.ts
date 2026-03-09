import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchStoryPage } from '../hackernews-api.js';
import { storySchema, mapStory } from './schemas.js';

export const listShowStories = defineTool({
  name: 'list_show_stories',
  displayName: 'List Show HN',
  description:
    'Get the latest Show HN stories. These are projects and products shared by the community. Returns 30 stories per page. Use page for pagination.',
  summary: 'Get Show HN stories',
  icon: 'eye',
  group: 'Stories',
  input: z.object({
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    stories: z.array(storySchema),
    has_more: z.boolean().describe('Whether more pages are available'),
  }),
  handle: async params => {
    const { stories, has_more } = await fetchStoryPage('/show', params.page ?? 1);
    return { stories: stories.map(mapStory), has_more };
  },
});
