import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageJson } from '../github-api.js';
import { type RawBranch, branchSchema, mapBranch } from './schemas.js';

interface BranchesPayload {
  branches: RawBranch[];
  hasMore: boolean;
}

export const listBranches = defineTool({
  name: 'list_branches',
  displayName: 'List Branches',
  description: 'List branches for a repository.',
  summary: 'List branches for a repository',
  icon: 'git-branch',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
  }),
  output: z.object({
    branches: z.array(branchSchema).describe('List of branches'),
  }),
  handle: async params => {
    const data = await pageJson<BranchesPayload>(`/${params.owner}/${params.repo}/branches`);
    return { branches: (data.branches ?? []).map(mapBranch) };
  },
});
