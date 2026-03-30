import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiRaw } from '../bitbucket-api.js';

export const getFileContent = defineTool({
  name: 'get_file_content',
  displayName: 'Get File Content',
  description: 'Read the raw content of a file from a Bitbucket repository at a given branch, tag, or commit.',
  summary: 'Read a file from a repository',
  icon: 'file-text',
  group: 'Source',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    path: z.string().describe('File path relative to repository root'),
    ref: z.string().optional().describe('Branch name, tag, or commit SHA — defaults to the repository default branch'),
  }),
  output: z.object({
    content: z.string().describe('Raw file content'),
    path: z.string().describe('File path'),
  }),
  handle: async params => {
    const ref = params.ref ?? 'HEAD';
    const content = await apiRaw(`/repositories/${params.workspace}/${params.repo_slug}/src/${ref}/${params.path}`);
    return { content, path: params.path };
  },
});
