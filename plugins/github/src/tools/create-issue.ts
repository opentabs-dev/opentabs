import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getMutationId, graphql, turboData } from '../github-api.js';
import { issueSchema } from './schemas.js';

interface CreateIssueResult {
  createIssue: {
    issue: {
      number?: number;
      title?: string;
      url?: string;
    };
  };
}

export const createIssue = defineTool({
  name: 'create_issue',
  displayName: 'Create Issue',
  description: 'Create a new issue in a repository.',
  summary: 'Create a new issue in a repository',
  icon: 'plus-circle',
  group: 'Issues',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    title: z.string().min(1).describe('Issue title'),
    body: z.string().optional().describe('Issue body in Markdown'),
  }),
  output: z.object({
    issue: issueSchema.describe('The created issue'),
  }),
  handle: async params => {
    // Discover the repository's GraphQL node ID via the issues page embedded data
    const { data: repoData } = await turboData<{ repository?: { id?: string } }>(
      `/${params.owner}/${params.repo}/issues`,
      { q: 'is:issue is:open' },
    );
    const repoId = repoData?.repository?.id;
    if (!repoId) throw ToolError.internal('Could not determine repository ID');

    const mutationId = await getMutationId('createIssueMutation');
    const result = await graphql<CreateIssueResult>(mutationId, {
      input: {
        repositoryId: repoId,
        title: params.title,
        body: params.body ?? '',
      },
    });

    const issue = result.createIssue?.issue;
    return {
      issue: {
        number: issue?.number ?? 0,
        title: issue?.title ?? params.title,
        state: 'open',
        body: params.body ?? '',
        html_url: issue?.url ?? `https://github.com/${params.owner}/${params.repo}/issues/${issue?.number ?? 0}`,
        user_login: '',
        labels: [],
        assignees: [],
        comments: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: '',
        is_pull_request: false,
      },
    };
  },
});
