import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawBranch, branchSchema, mapBranch } from './schemas.js';

export const createBranch = defineTool({
  name: 'create_branch',
  displayName: 'Create Branch',
  description: 'Create a new branch in a Bitbucket repository from a commit hash or existing branch name.',
  summary: 'Create a new branch',
  icon: 'git-branch-plus',
  group: 'Branches & Tags',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    name: z.string().describe('New branch name'),
    target_hash: z.string().describe('Commit hash to branch from, or branch name'),
  }),
  output: branchSchema,
  handle: async params => {
    const data = await api<RawBranch>(`/repositories/${params.workspace}/${params.repo_slug}/refs/branches`, {
      method: 'POST',
      body: { name: params.name, target: { hash: params.target_hash } },
    });
    return mapBranch(data);
  },
});
