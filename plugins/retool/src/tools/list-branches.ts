import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { branchSchema, mapBranch, type RawBranch } from './schemas.js';

export const listBranches = defineTool({
  name: 'list_branches',
  displayName: 'List Branches',
  description:
    'List all source control branches in the Retool organization. Branches are used for version control when source control is configured.',
  summary: 'List source control branches',
  icon: 'git-branch',
  group: 'Source Control',
  input: z.object({}),
  output: z.object({
    branches: z.array(branchSchema).describe('List of branches'),
  }),
  handle: async () => {
    const data = await api<{ branches: RawBranch[] }>('/api/branches');
    return { branches: (data.branches ?? []).map(mapBranch) };
  },
});
