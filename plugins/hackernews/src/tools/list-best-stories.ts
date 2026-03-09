import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchStoryPage } from '../hackernews-api.js';
import { storySchema, mapStory } from './schemas.js';

export const listBestStories = defineTool({
  name: 'list_best_stories',
  displayName: 'List Best Stories',
  description:
    'Get the best stories on Hacker News. These are historically high-performing stories. Returns 30 stories per page. Use page for pagination.',
  summary: 'Get best stories',
  icon: 'award',
  group: 'Stories',
  input: z.object({
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    stories: z.array(storySchema),
    has_more: z.boolean().describe('Whether more pages are available'),
  }),
  handle: async params => {
    const { stories, has_more } = await fetchStoryPage('/best', params.page ?? 1);
    return { stories: stories.map(mapStory), has_more };
  },
});
