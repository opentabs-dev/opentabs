import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';
import { pullRequestSchema } from './schemas.js';

export const createPullRequest = defineTool({
  name: 'create_pull_request',
  displayName: 'Create Pull Request',
  description: 'Create a new pull request.',
  summary: 'Create a new pull request',
  icon: 'git-pull-request-arrow',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    title: z.string().min(1).describe('Pull request title'),
    head: z.string().min(1).describe('Source branch name'),
    base: z.string().min(1).describe('Target branch name to merge into'),
    body: z.string().optional().describe('Pull request description in Markdown'),
    draft: z.boolean().optional().describe('Create as a draft PR (default: false)'),
  }),
  output: z.object({
    pull_request: pullRequestSchema.describe('The created pull request'),
  }),
  handle: async params => {
    // GitHub's compare page has a form for creating PRs.
    // POST to /:owner/:repo/compare with the head and base branches.
    const fields: Record<string, string> = {
      'pull_request[title]': params.title,
      'pull_request[head]': params.head,
      'pull_request[base]': params.base,
    };
    if (params.body) fields['pull_request[body]'] = params.body;
    if (params.draft) fields['pull_request[draft]'] = '1';

    await submitPageForm(
      `/${params.owner}/${params.repo}/compare/${params.base}...${params.head}`,
      'form#new_pull_request, form[action*="pull"]',
      fields,
    );

    return {
      pull_request: {
        number: 0,
        title: params.title,
        state: 'open',
        body: params.body ?? '',
        html_url: `https://github.com/${params.owner}/${params.repo}/pulls`,
        user_login: '',
        head_ref: params.head,
        base_ref: params.base,
        labels: [],
        draft: params.draft ?? false,
        merged: false,
        mergeable: false,
        comments: 0,
        commits: 0,
        additions: 0,
        deletions: 0,
        changed_files: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
  },
});
