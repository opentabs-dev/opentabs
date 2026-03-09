import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchStoryPage } from '../hackernews-api.js';
import { storySchema, mapStory } from './schemas.js';

export const listNewStories = defineTool({
  name: 'list_new_stories',
  displayName: 'List New Stories',
  description:
    'Get the newest stories on Hacker News, sorted by submission time (most recent first). Returns 30 stories per page. Use page for pagination.',
  summary: 'Get newest stories',
  icon: 'clock',
  group: 'Stories',
  input: z.object({
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    stories: z.array(storySchema),
    has_more: z.boolean().describe('Whether more pages are available'),
  }),
  handle: async params => {
    const { stories, has_more } = await fetchStoryPage('/newest', params.page ?? 1);
    return { stories: stories.map(mapStory), has_more };
  },
});
