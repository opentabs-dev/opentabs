import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discoverQueryId, graphql } from '../github-api.js';
import { type RawIssueOrPR, mapPullRequest, pullRequestSchema, relayNodeToRaw } from './schemas.js';

// IssueIndexPageQuery is the Relay query used by the issues/PR list page.
// Its query ID is discovered at runtime from embedded page data.
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

export const listPullRequests = defineTool({
  name: 'list_pull_requests',
  displayName: 'List Pull Requests',
  description: 'List pull requests for a repository with optional state and sort filters.',
  summary: 'List pull requests for a repository',
  icon: 'git-pull-request',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('PR state filter (default: open)'),
    sort: z
      .enum(['created', 'updated', 'popularity', 'long-running'])
      .optional()
      .describe('Sort field (default: created)'),
    direction: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 25)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    pull_requests: z.array(pullRequestSchema).describe('List of pull requests'),
  }),
  handle: async params => {
    const state = params.state ?? 'open';
    const sort = params.sort === 'popularity' ? 'reactions' : (params.sort ?? 'created');
    const dir = params.direction ?? 'desc';
    const perPage = params.per_page ?? 25;
    const page = params.page ?? 1;

    // Build the search query for IssueIndexPageQuery
    const stateFilter = state === 'all' ? '' : `is:${state}`;
    const sortFilter = `sort:${sort}-${dir}`;
    const query = `is:pr ${stateFilter} repo:${params.owner}/${params.repo} ${sortFilter}`.trim();

    // Discover the persisted query ID for IssueIndexPageQuery
    const queryId = await discoverQueryId(ISSUE_INDEX_QUERY_NAME, `/${params.owner}/${params.repo}/issues`, {
      type: 'pr',
      q: 'is:pr is:open',
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
    const pullRequests = edges
      .map(e => relayNodeToRaw(e.node))
      .filter((n): n is RawIssueOrPR => n.__typename === 'PullRequest')
      .map(n => mapPullRequest(n, { owner: params.owner, repo: params.repo }));

    return { pull_requests: pullRequests };
  },
});
