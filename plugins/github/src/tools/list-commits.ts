import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

const commitSchema = z.object({
  sha: z.string().describe('Full commit SHA'),
  message: z.string().describe('Commit message'),
  author_name: z.string().describe('Author name'),
  author_email: z.string().describe('Author email'),
  date: z.string().describe('Authored date ISO 8601 timestamp'),
  url: z.string().describe('URL to the commit on GitHub'),
});

interface RawCommit {
  sha?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
  };
  html_url?: string;
}

const mapCommit = (c: RawCommit) => ({
  sha: c.sha ?? '',
  message: c.commit?.message ?? '',
  author_name: c.commit?.author?.name ?? '',
  author_email: c.commit?.author?.email ?? '',
  date: c.commit?.author?.date ?? '',
  url: c.html_url ?? '',
});

export const listCommits = defineTool({
  name: 'list_commits',
  displayName: 'List Commits',
  description:
    'List commits for a repository. Optionally filter by branch, tag, or SHA. Returns commits sorted by date descending.',
  summary: 'List commits for a repository',
  icon: 'git-commit',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    sha: z.string().optional().describe('Branch name, tag, or commit SHA to list commits from'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    commits: z.array(commitSchema).describe('List of commits'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      per_page: params.per_page ?? 30,
      page: params.page,
    };
    if (params.sha) query.sha = params.sha;

    const data = await api<RawCommit[]>(`/repos/${params.owner}/${params.repo}/commits`, { query });
    return { commits: (data ?? []).map(mapCommit) };
  },
});
