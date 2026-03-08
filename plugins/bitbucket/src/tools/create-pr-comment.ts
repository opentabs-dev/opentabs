import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawComment, commentSchema, mapComment } from './schemas.js';

export const createPrComment = defineTool({
  name: 'create_pr_comment',
  displayName: 'Create PR Comment',
  description: 'Add a comment to a pull request.',
  summary: 'Add a comment to a pull request',
  icon: 'message-square-plus',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pull_request_id: z.number().int().describe('Pull request ID'),
    content: z.string().describe('Comment content in Markdown'),
  }),
  output: commentSchema,
  handle: async params => {
    const data = await api<RawComment>(
      `/repositories/${params.workspace}/${params.repo_slug}/pullrequests/${params.pull_request_id}/comments`,
      { method: 'POST', body: { content: { raw: params.content } } },
    );
    return mapComment(data);
  },
});
