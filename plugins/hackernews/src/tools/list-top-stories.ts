import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchStoryPage } from '../hackernews-api.js';
import { storySchema, mapStory } from './schemas.js';

export const listTopStories = defineTool({
  name: 'list_top_stories',
  displayName: 'List Top Stories',
  description:
    'Get the current top stories from the Hacker News front page. Returns 30 stories per page ranked by the HN algorithm. Use page for pagination.',
  summary: 'Get current front page stories',
  icon: 'trending-up',
  group: 'Stories',
  input: z.object({
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    stories: z.array(storySchema),
    has_more: z.boolean().describe('Whether more pages are available'),
  }),
  handle: async params => {
    const { stories, has_more } = await fetchStoryPage('/news', params.page ?? 1);
    return { stories: stories.map(mapStory), has_more };
  },
});
