import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

const deleteCommitSchema = z.object({
  sha: z.string().describe('Commit SHA'),
  message: z.string().describe('Commit message'),
  url: z.string().describe('URL to the commit on GitHub'),
});

interface RawDeleteResponse {
  commit?: {
    sha?: string;
    message?: string;
    html_url?: string;
  };
}

export const deleteFile = defineTool({
  name: 'delete_file',
  displayName: 'Delete File',
  description:
    'Delete a file from a repository. Requires the current file SHA (obtainable from the contents API). Commits directly to the specified branch.',
  summary: 'Delete a file from a repository',
  icon: 'file-x',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    path: z.string().min(1).describe('File path relative to repository root'),
    message: z.string().min(1).describe('Commit message for the deletion'),
    sha: z.string().min(1).describe('SHA of the file being deleted — required to prevent accidental overwrites'),
    branch: z.string().optional().describe('Branch to commit to (defaults to the default branch)'),
  }),
  output: z.object({
    commit: deleteCommitSchema.describe('The commit created by the deletion'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      message: params.message,
      sha: params.sha,
    };
    if (params.branch !== undefined) body.branch = params.branch;

    const encodedPath = params.path.split('/').map(encodeURIComponent).join('/');
    const data = await api<RawDeleteResponse>(`/repos/${params.owner}/${params.repo}/contents/${encodedPath}`, {
      method: 'DELETE',
      body,
    });
    return {
      commit: {
        sha: data.commit?.sha ?? '',
        message: data.commit?.message ?? '',
        url: data.commit?.html_url ?? '',
      },
    };
  },
});
