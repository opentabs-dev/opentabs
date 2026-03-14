import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageJson } from '../github-api.js';
import { type RawRepo, mapRepository, repositorySchema } from './schemas.js';

interface SearchPayload {
  results?: RawRepo[];
  result_count?: number;
  page?: number;
  page_count?: number;
}

export const searchRepos = defineTool({
  name: 'search_repos',
  displayName: 'Search Repositories',
  description:
    'Search for repositories across GitHub. Supports GitHub search syntax (e.g., "repo:owner/name", "language:typescript", "stars:>1000").',
  summary: 'Search repositories on GitHub',
  icon: 'search',
  group: 'Search',
  input: z.object({
    query: z
      .string()
      .min(1)
      .describe('Search query using GitHub search syntax (e.g., "language:typescript stars:>1000")'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    total_count: z.number().describe('Total number of matching repositories'),
    repositories: z.array(repositorySchema).describe('List of matching repositories'),
  }),
  handle: async params => {
    const data = await pageJson<SearchPayload>('/search', {
      type: 'repositories',
      q: params.query,
      p: params.page ?? 1,
    });

    return {
      total_count: data.result_count ?? 0,
      repositories: (data.results ?? []).map(r => mapRepository(r)),
    };
  },
});
