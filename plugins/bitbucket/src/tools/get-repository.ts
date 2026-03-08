import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawRepo, repositorySchema, mapRepository } from './schemas.js';

export const getRepository = defineTool({
  name: 'get_repository',
  displayName: 'Get Repository',
  description: 'Get detailed information about a specific Bitbucket repository.',
  summary: 'Get repository details',
  icon: 'book',
  group: 'Repositories',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
  }),
  output: repositorySchema,
  handle: async params => {
    const data = await api<RawRepo>(`/repositories/${params.workspace}/${params.repo_slug}`);
    return mapRepository(data);
  },
});
