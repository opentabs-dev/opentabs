import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawRepo, repositorySchema, mapRepository } from './schemas.js';

export const listRepositories = defineTool({
  name: 'list_repositories',
  displayName: 'List Repositories',
  description:
    'List repositories in a Bitbucket workspace. Supports pagination and filtering with Bitbucket query language.',
  summary: 'List repositories in a workspace',
  icon: 'book',
  group: 'Repositories',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
    query: z.string().optional().describe('Bitbucket query language filter (e.g., \'name ~ "my-repo"\')'),
  }),
  output: z.object({
    repositories: z.array(repositorySchema).describe('Array of repositories'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
      q: params.query,
    };
    const data = await api<{ values: RawRepo[] }>(`/repositories/${params.workspace}`, { query });
    return { repositories: (data.values ?? []).map(mapRepository) };
  },
});
