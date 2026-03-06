import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';
import { mapRepository, repositorySchema } from './schemas.js';

interface RawSearchResponse {
  total_count?: number;
  items?: Record<string, unknown>[];
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
    sort: z.enum(['stars', 'forks', 'help-wanted-issues', 'updated']).optional().describe('Sort field'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort order (default: desc)'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    total_count: z.number().describe('Total number of matching repositories'),
    repositories: z.array(repositorySchema).describe('List of matching repositories'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      q: params.query,
      per_page: params.per_page ?? 30,
      page: params.page,
      sort: params.sort,
      order: params.order,
    };

    const data = await api<RawSearchResponse>('/search/repositories', { query });
    return {
      total_count: data.total_count ?? 0,
      repositories: (data.items ?? []).map(mapRepository),
    };
  },
});
