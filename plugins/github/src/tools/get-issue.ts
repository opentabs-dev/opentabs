import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { turboData } from '../github-api.js';
import { issueSchema } from './schemas.js';

interface IssueViewerResult {
  repository: {
    issue: {
      number?: number;
      title?: string;
      body?: string;
      state?: string;
      createdAt?: string;
      updatedAt?: string;
      closedAt?: string | null;
      author?: { login?: string };
      labels?: { edges?: Array<{ node?: { name?: string } }> };
      assignedActors?: { nodes?: Array<{ login?: string }> };
      linkedPullRequests?: { nodes?: Array<{ number?: number }> };
    };
  };
}

export const getIssue = defineTool({
  name: 'get_issue',
  displayName: 'Get Issue',
  description: 'Get detailed information about a specific issue, including its full body.',
  summary: 'Get details of a specific issue',
  icon: 'circle-dot',
  group: 'Issues',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    issue_number: z.number().int().min(1).describe('Issue number'),
  }),
  output: z.object({
    issue: issueSchema.describe('Issue details'),
  }),
  handle: async params => {
    const result = await turboData<IssueViewerResult>(`/${params.owner}/${params.repo}/issues/${params.issue_number}`);

    const issue = result.data?.repository?.issue;
    const labels = (issue?.labels?.edges ?? []).map(e => e.node?.name ?? '').filter(Boolean);
    const assignees = (issue?.assignedActors?.nodes ?? []).map(a => a.login ?? '').filter(Boolean);
    const state = issue?.state?.toLowerCase() ?? '';
    const isPR = false; // This is specifically the issues endpoint

    return {
      issue: {
        number: issue?.number ?? params.issue_number,
        title: issue?.title ?? '',
        state,
        body: issue?.body ?? '',
        html_url: `https://github.com/${params.owner}/${params.repo}/issues/${params.issue_number}`,
        user_login: issue?.author?.login ?? '',
        labels,
        assignees,
        comments: 0, // Not available in this query
        created_at: issue?.createdAt ?? '',
        updated_at: issue?.updatedAt ?? '',
        closed_at: issue?.closedAt ?? '',
        is_pull_request: isPR,
      },
    };
  },
});
