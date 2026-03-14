import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageEmbeddedData } from '../github-api.js';

interface BlobPageData {
  'codeViewBlobLayoutRoute.StyledBlob'?: {
    rawLines?: string[];
  };
}

export const getFileContent = defineTool({
  name: 'get_file_content',
  displayName: 'Get File Content',
  description:
    'Read a file from a repository. Returns the raw content as text. Use the ref parameter to read from a specific branch or commit.',
  summary: 'Read a file from a repository',
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
    const ref = params.ref ?? 'HEAD';
    const data = await pageEmbeddedData<BlobPageData>(`/${params.owner}/${params.repo}/blob/${ref}/${params.path}`);

    const rawLines = data['codeViewBlobLayoutRoute.StyledBlob']?.rawLines;
    const content = rawLines ? rawLines.join('\n') : '';
    return { content, path: params.path };
  },
});
