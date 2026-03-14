import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';

export const createOrUpdateFile = defineTool({
  name: 'create_or_update_file',
  displayName: 'Create or Update File',
  description: 'Create or update a file in a repository. Commits directly to the specified branch.',
  summary: 'Create or update a file in a repository',
  icon: 'file-edit',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    path: z.string().min(1).describe('File path relative to repository root'),
    content: z.string().min(1).describe('File content as a UTF-8 string'),
    message: z.string().min(1).describe('Commit message'),
    branch: z.string().optional().describe('Branch to commit to (defaults to the default branch)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the file was created/updated'),
  }),
  handle: async params => {
    const branch = params.branch ?? 'main';

    // GitHub's file editor page has a form for creating/updating files.
    // For new files: /:owner/:repo/new/:branch
    // For existing files: /:owner/:repo/edit/:branch/:path
    const fields: Record<string, string> = {
      value: params.content,
      message: params.message,
      placeholder_message: params.message,
      'commit-choice': 'direct',
      target_branch: branch,
      quick_pull: '',
      filename: params.path.split('/').pop() ?? '',
    };

    // Try the edit path first (for existing files), fall back to new path
    try {
      await submitPageForm(
        `/${params.owner}/${params.repo}/edit/${branch}/${params.path}`,
        'form.js-blob-form',
        fields,
      );
    } catch {
      await submitPageForm(`/${params.owner}/${params.repo}/new/${branch}`, 'form.js-blob-form', fields);
    }

    return { success: true };
  },
});
