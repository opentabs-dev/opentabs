import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';

export const deleteFile = defineTool({
  name: 'delete_file',
  displayName: 'Delete File',
  description: 'Delete a file from a repository. Commits directly to the specified branch.',
  summary: 'Delete a file from a repository',
  icon: 'file-x',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    path: z.string().min(1).describe('File path relative to repository root'),
    message: z.string().min(1).describe('Commit message for the deletion'),
    branch: z.string().optional().describe('Branch to commit to (defaults to the default branch)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the file was deleted'),
  }),
  handle: async params => {
    const branch = params.branch ?? 'main';

    await submitPageForm(`/${params.owner}/${params.repo}/delete/${branch}/${params.path}`, 'form[action*="delete"]', {
      message: params.message,
      commit_choice: 'direct',
      target_branch: branch,
    });

    return { success: true };
  },
});
