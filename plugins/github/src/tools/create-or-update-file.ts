import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

export const createOrUpdateFile = defineTool({
  name: 'create_or_update_file',
  displayName: 'Create or Update File',
  description:
    'Create or update a file in a repository. To update an existing file, provide the current file SHA (obtainable from the contents API). Commits directly to the specified branch.',
  icon: 'file-edit',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    path: z.string().min(1).describe('File path relative to repository root'),
    content: z.string().min(1).describe('File content as a UTF-8 string (will be base64-encoded automatically)'),
    message: z.string().min(1).describe('Commit message'),
    branch: z.string().optional().describe('Branch to commit to (defaults to the default branch)'),
    sha: z.string().optional().describe('SHA of the file being replaced — required when updating an existing file'),
  }),
  output: z.object({
    sha: z.string().describe('SHA of the created/updated file blob'),
    commit_sha: z.string().describe('SHA of the commit'),
    html_url: z.string().describe('URL to the file on GitHub'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      message: params.message,
      content: btoa(unescape(encodeURIComponent(params.content))),
    };
    if (params.branch) body.branch = params.branch;
    if (params.sha) body.sha = params.sha;

    const encodedPath = params.path.split('/').map(encodeURIComponent).join('/');
    const data = await api<{
      content?: { sha?: string; html_url?: string };
      commit?: { sha?: string };
    }>(`/repos/${params.owner}/${params.repo}/contents/${encodedPath}`, {
      method: 'PUT',
      body,
    });

    return {
      sha: data.content?.sha ?? '',
      commit_sha: data.commit?.sha ?? '',
      html_url: data.content?.html_url ?? '',
    };
  },
});
