import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';

export const deleteBranch = defineTool({
  name: 'delete_branch',
  displayName: 'Delete Branch',
  description: 'Delete a branch from a Bitbucket repository. This action cannot be undone.',
  summary: 'Delete a branch',
  icon: 'trash',
  group: 'Branches & Tags',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    name: z.string().describe('Branch name to delete'),
  }),
  output: z.object({
    deleted: z.boolean().describe('Whether the branch was deleted'),
  }),
  handle: async params => {
    await api(`/repositories/${params.workspace}/${params.repo_slug}/refs/branches/${params.name}`, {
      method: 'DELETE',
    });
    return { deleted: true };
  },
});
