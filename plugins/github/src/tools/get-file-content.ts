import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiRaw } from '../github-api.js';

export const getFileContent = defineTool({
  name: 'get_file_content',
  displayName: 'Get File Content',
  description:
    'Read a file from a repository. Returns the raw content as text. Use the ref parameter to read from a specific branch or commit.',
  icon: 'file-text',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    path: z.string().min(1).describe('File path relative to repository root (e.g., "src/index.ts")'),
    ref: z.string().optional().describe('Branch name, tag, or commit SHA (defaults to the default branch)'),
  }),
  output: z.object({
    content: z.string().describe('Raw file content as text'),
    path: z.string().describe('File path'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params.ref) query.ref = params.ref;

    const encodedPath = params.path.split('/').map(encodeURIComponent).join('/');
    const content = await apiRaw(`/repos/${params.owner}/${params.repo}/contents/${encodedPath}`, {
      query,
      accept: 'application/vnd.github.raw+json',
    });
    return { content, path: params.path };
  },
});
