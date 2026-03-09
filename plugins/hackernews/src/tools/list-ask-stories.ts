import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchStoryPage } from '../hackernews-api.js';
import { storySchema, mapStory } from './schemas.js';

export const listAskStories = defineTool({
  name: 'list_ask_stories',
  displayName: 'List Ask HN',
  description:
    'Get the latest Ask HN stories. These are questions posted by the community for discussion. Returns 30 stories per page. Use page for pagination.',
  summary: 'Get Ask HN stories',
  icon: 'help-circle',
  group: 'Stories',
  input: z.object({
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    stories: z.array(storySchema),
    has_more: z.boolean().describe('Whether more pages are available'),
  }),
  handle: async params => {
    const { stories, has_more } = await fetchStoryPage('/ask', params.page ?? 1);
    return { stories: stories.map(mapStory), has_more };
  },
});
