import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

export const addReaction = defineTool({
  name: 'add_reaction',
  displayName: 'Add Reaction',
  description: 'Add a reaction to an issue, pull request, or comment.',
  icon: 'smile-plus',
  group: 'Reactions',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    content: z
      .enum(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'])
      .describe('Reaction emoji name'),
    issue_number: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Issue or PR number — provide this OR comment_id, not both'),
    comment_id: z.number().int().min(1).optional().describe('Comment ID — provide this OR issue_number, not both'),
  }),
  output: z.object({
    id: z.number().describe('Reaction ID'),
    content: z.string().describe('Reaction emoji name'),
  }),
  handle: async params => {
    let endpoint: string;
    if (params.comment_id) {
      endpoint = `/repos/${params.owner}/${params.repo}/issues/comments/${params.comment_id}/reactions`;
    } else if (params.issue_number) {
      endpoint = `/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/reactions`;
    } else {
      throw ToolError.validation('Either issue_number or comment_id must be provided');
    }

    const data = await api<{ id?: number; content?: string }>(endpoint, {
      method: 'POST',
      body: { content: params.content },
    });
    return {
      id: data.id ?? 0,
      content: data.content ?? '',
    };
  },
});
