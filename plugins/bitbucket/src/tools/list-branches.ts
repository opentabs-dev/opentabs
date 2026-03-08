import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawBranch, branchSchema, mapBranch } from './schemas.js';

export const listBranches = defineTool({
  name: 'list_branches',
  displayName: 'List Branches',
  description: 'List branches in a Bitbucket repository. Supports pagination and filtering.',
  summary: 'List repository branches',
  icon: 'git-branch',
  group: 'Branches & Tags',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
    query: z.string().optional().describe('Filter branches by name (Bitbucket query language)'),
  }),
  output: z.object({
    branches: z.array(branchSchema).describe('Array of branches'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
      q: params.query,
    };
    const data = await api<{ values: RawBranch[] }>(
      `/repositories/${params.workspace}/${params.repo_slug}/refs/branches`,
      { query },
    );
    return { branches: (data.values ?? []).map(mapBranch) };
  },
});
