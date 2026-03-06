import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

const compareFileSchema = z.object({
  filename: z.string().describe('File path'),
  status: z.string().describe('File status: added, removed, modified, renamed, copied, changed, unchanged'),
  additions: z.number().describe('Number of lines added'),
  deletions: z.number().describe('Number of lines deleted'),
});

const compareCommitSchema = z.object({
  sha: z.string().describe('Full commit SHA'),
  message: z.string().describe('Commit message'),
});

interface RawCompareFile {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
}

interface RawCompareCommit {
  sha?: string;
  commit?: { message?: string };
}

interface RawCompareResponse {
  status?: string;
  ahead_by?: number;
  behind_by?: number;
  total_commits?: number;
  files?: RawCompareFile[];
  commits?: RawCompareCommit[];
}

export const compareCommits = defineTool({
  name: 'compare_commits',
  displayName: 'Compare Commits',
  description:
    'Compare two commits, branches, or tags. Returns the diff status, commit count, and changed files between the base and head.',
  summary: 'Compare two commits or branches',
  icon: 'git-compare',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    basehead: z
      .string()
      .min(1)
      .describe('Base and head to compare in "base...head" format (e.g., "main...feature-branch")'),
  }),
  output: z.object({
    status: z.string().describe('Comparison status: ahead, behind, diverged, or identical'),
    ahead_by: z.number().describe('Number of commits head is ahead of base'),
    behind_by: z.number().describe('Number of commits head is behind base'),
    total_commits: z.number().describe('Total number of commits in the comparison'),
    files: z.array(compareFileSchema).describe('List of changed files'),
    commits: z.array(compareCommitSchema).describe('List of commits'),
  }),
  handle: async params => {
    const data = await api<RawCompareResponse>(`/repos/${params.owner}/${params.repo}/compare/${params.basehead}`);
    return {
      status: data.status ?? '',
      ahead_by: data.ahead_by ?? 0,
      behind_by: data.behind_by ?? 0,
      total_commits: data.total_commits ?? 0,
      files: (data.files ?? []).map(f => ({
        filename: f.filename ?? '',
        status: f.status ?? '',
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      })),
      commits: (data.commits ?? []).map(c => ({
        sha: c.sha ?? '',
        message: c.commit?.message ?? '',
      })),
    };
  },
});
