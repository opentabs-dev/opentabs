import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

const prFileSchema = z.object({
  filename: z.string().describe('File path'),
  status: z.string().describe('File status: added, removed, modified, renamed, copied, changed, unchanged'),
  additions: z.number().describe('Number of lines added'),
  deletions: z.number().describe('Number of lines deleted'),
  changes: z.number().describe('Total number of line changes'),
  patch: z.string().describe('Unified diff patch text (may be empty for binary files)'),
});

interface RawPrFile {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
}

const mapPrFile = (f: RawPrFile) => ({
  filename: f.filename ?? '',
  status: f.status ?? '',
  additions: f.additions ?? 0,
  deletions: f.deletions ?? 0,
  changes: f.changes ?? 0,
  patch: f.patch ?? '',
});

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
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    files: z.array(prFileSchema).describe('List of changed files'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      per_page: params.per_page ?? 30,
      page: params.page,
    };

    const data = await api<RawPrFile[]>(`/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/files`, {
      query,
    });
    return { files: (data ?? []).map(mapPrFile) };
  },
});
