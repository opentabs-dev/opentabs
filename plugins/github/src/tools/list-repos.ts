import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getLogin, pageJson } from '../github-api.js';
import { type RawRepo, mapRepository, repositorySchema } from './schemas.js';

interface SearchPayload {
  results?: RawRepo[];
  result_count?: number;
}

export const listRepos = defineTool({
  name: 'list_repos',
  displayName: 'List Repositories',
  description:
    'List repositories for the authenticated user or a specified user/organization. Returns repos sorted by last updated.',
  summary: 'List repositories for a user or organization',
  icon: 'book-marked',
  group: 'Repositories',
  input: z.object({
    owner: z.string().optional().describe('Username or org name — defaults to the authenticated user'),
    sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional().describe('Sort field (default: updated)'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    repositories: z.array(repositorySchema).describe('List of repositories'),
  }),
  handle: async params => {
    const owner = params.owner ?? getLogin();
    const sort = params.sort ?? 'updated';

    // Use same-origin /search endpoint which works for private repos
    const sortMap: Record<string, string> = {
      updated: 'updated',
      created: 'created',
      pushed: 'updated',
      full_name: 'repositories',
    };

    const data = await pageJson<SearchPayload>('/search', {
      type: 'repositories',
      q: `user:${owner}`,
      s: sortMap[sort] ?? 'updated',
      o: 'desc',
      p: params.page ?? 1,
    });

    return {
      repositories: (data.results ?? []).map(r => mapRepository(r)),
    };
  },
});
