import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageEmbeddedData } from '../github-api.js';
import { type RawFileDiff, fileDiffSchema, mapFileDiff } from './schemas.js';

interface PRFilesPageData {
  pullRequestsChangesRoute?: {
    diffSummaries?: RawFileDiff[];
  };
}

export const listPullRequestFiles = defineTool({
  name: 'list_pull_request_files',
  displayName: 'List Pull Request Files',
  description:
    'List files changed in a pull request. Returns filenames, change status, and line-level diff statistics.',
  summary: 'List files changed in a pull request',
  icon: 'files',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    pull_number: z.number().int().min(1).describe('Pull request number'),
  }),
  output: z.object({
    files: z.array(fileDiffSchema).describe('List of changed files'),
  }),
  handle: async params => {
    const data = await pageEmbeddedData<PRFilesPageData>(
      `/${params.owner}/${params.repo}/pull/${params.pull_number}/files`,
    );
    const summaries = data.pullRequestsChangesRoute?.diffSummaries ?? [];
    return { files: summaries.map(mapFileDiff) };
  },
});
