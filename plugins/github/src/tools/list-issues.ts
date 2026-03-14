import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discoverQueryId, graphql } from '../github-api.js';
import { type RawIssueOrPR, issueSchema, mapIssue, relayNodeToRaw } from './schemas.js';

const ISSUE_INDEX_QUERY_NAME = 'IssueIndexPageQuery';

interface IssueIndexResult {
  repository: {
    search: {
      issueCount: number;
      pageInfo: { endCursor: string; hasNextPage: boolean };
      edges: Array<{ node: Record<string, unknown> }>;
    };
  };
}

export const listIssues = defineTool({
  name: 'list_issues',
  displayName: 'List Issues',
  description:
    'List issues for a repository. By default returns open issues sorted by creation date. Can filter by state, labels, assignee, and more.',
  summary: 'List issues for a repository',
  icon: 'circle-dot',
  group: 'Issues',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state filter (default: open)'),
    labels: z.string().optional().describe('Comma-separated list of label names to filter by'),
    assignee: z.string().optional().describe('Filter by assignee login, or "none" for unassigned, "*" for any'),
    sort: z.enum(['created', 'updated', 'comments']).optional().describe('Sort field (default: created)'),
    direction: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 25)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    issues: z.array(issueSchema).describe('List of issues'),
  }),
  handle: async params => {
    const state = params.state ?? 'open';
    const sort = params.sort ?? 'created';
    const dir = params.direction ?? 'desc';
    const perPage = params.per_page ?? 25;
    const page = params.page ?? 1;

    // Build search query for IssueIndexPageQuery
    const parts = [`is:issue`, `repo:${params.owner}/${params.repo}`];
    if (state !== 'all') parts.push(`is:${state}`);
    if (params.labels) {
      for (const label of params.labels.split(',')) {
        parts.push(`label:"${label.trim()}"`);
      }
    }
    if (params.assignee) {
      if (params.assignee === 'none') parts.push('no:assignee');
      else if (params.assignee !== '*') parts.push(`assignee:${params.assignee}`);
    }
    parts.push(`sort:${sort}-${dir}`);
    const query = parts.join(' ');

    const queryId = await discoverQueryId(ISSUE_INDEX_QUERY_NAME, `/${params.owner}/${params.repo}/issues`, {
      q: 'is:issue is:open',
    });

    const skip = (page - 1) * perPage;

    const data = await graphql<IssueIndexResult>(queryId, {
      owner: params.owner,
      name: params.repo,
      query,
      skip,
      includeReactions: false,
    });

    const edges = data?.repository?.search?.edges ?? [];
    const issues = edges
      .map(e => relayNodeToRaw(e.node))
      .filter((n): n is RawIssueOrPR => n.__typename === 'Issue')
      .map(n => mapIssue(n, { owner: params.owner, repo: params.repo }));

    return { issues };
  },
});
