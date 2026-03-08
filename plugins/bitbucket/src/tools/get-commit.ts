import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawCommit, commitSchema, mapCommit } from './schemas.js';

export const getCommit = defineTool({
  name: 'get_commit',
  displayName: 'Get Commit',
  description: 'Get detailed information about a specific commit.',
  summary: 'Get commit details',
  icon: 'git-commit',
  group: 'Commits',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    commit_hash: z.string().describe('Full or short commit SHA'),
  }),
  output: commitSchema,
  handle: async params => {
    const data = await api<RawCommit>(
      `/repositories/${params.workspace}/${params.repo_slug}/commit/${params.commit_hash}`,
    );
    return mapCommit(data);
  },
});
