import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchStoryPage } from '../hackernews-api.js';
import { storySchema, mapStory } from './schemas.js';

export const listJobStories = defineTool({
  name: 'list_job_stories',
  displayName: 'List Jobs',
  description: 'Get the latest job postings on Hacker News. Returns 30 jobs per page. Use page for pagination.',
  summary: 'Get job postings',
  icon: 'briefcase',
  group: 'Stories',
  input: z.object({
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    stories: z.array(storySchema),
    has_more: z.boolean().describe('Whether more pages are available'),
  }),
  handle: async params => {
    const { stories, has_more } = await fetchStoryPage('/jobs', params.page ?? 1);
    return { stories: stories.map(mapStory), has_more };
  },
});
