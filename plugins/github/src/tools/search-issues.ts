import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageJson } from '../github-api.js';
import { issueSchema, mapIssue } from './schemas.js';

// Same-origin search result shape
interface SearchResult {
  author_name?: string;
  number?: number;
  state?: string;
  hl_title?: string;
  hl_text?: string;
  created?: string;
  updated?: string;
  closed_at?: string;
  labels?: Array<{ name?: string; color?: string }>;
  merged?: boolean;
  issue?: { issue?: { pull_request_id?: number | null } };
  repo?: { repository?: { name?: string; owner_login?: string } };
}

interface SearchPayload {
  results?: SearchResult[];
  result_count?: number;
  page?: number;
  page_count?: number;
}

export const searchIssues = defineTool({
  name: 'search_issues',
  displayName: 'Search Issues',
  description:
    'Search issues and pull requests across GitHub. Uses GitHub search syntax — e.g., "repo:owner/name is:open label:bug".',
  summary: 'Search issues and pull requests',
  icon: 'search',
  group: 'Issues',
  input: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        'Search query using GitHub search syntax (e.g., "repo:owner/name is:open label:bug", "org:myorg is:pr is:merged")',
      ),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    total_count: z.number().describe('Total number of matching results'),
    issues: z.array(issueSchema).describe('List of matching issues/PRs'),
  }),
  handle: async params => {
    const data = await pageJson<SearchPayload>('/search', {
      type: 'issues',
      q: params.query,
      p: params.page ?? 1,
    });

    const issues = (data.results ?? []).map((r: SearchResult) => {
      const owner = r.repo?.repository?.owner_login ?? '';
      const repo = r.repo?.repository?.name ?? '';
      const isPR = r.issue?.issue?.pull_request_id !== null && r.issue?.issue?.pull_request_id !== undefined;
      return mapIssue(
        {
          number: r.number,
          title: r.hl_title?.replace(/<\/?em>/g, ''),
          state: r.state,
          created_at: r.created,
          updated_at: r.updated,
          closed_at: r.closed_at,
          labels: r.labels,
          pull_request: isPR ? {} : undefined,
          user: { login: r.author_name },
        },
        { owner, repo },
      );
    });

    return {
      total_count: data.result_count ?? 0,
      issues,
    };
  },
});
