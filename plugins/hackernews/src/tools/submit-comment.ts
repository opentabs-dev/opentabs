import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitComment } from '../hackernews-api.js';

export const submitCommentTool = defineTool({
  name: 'submit_comment',
  displayName: 'Submit Comment',
  description:
    'Submit a comment on a Hacker News story or reply to an existing comment. Requires being logged in. The parent_id can be a story ID (to post a top-level comment) or a comment ID (to reply to that comment).',
  summary: 'Post a comment or reply on Hacker News',
  icon: 'message-square-plus',
  group: 'Items',
  input: z.object({
    parent_id: z.number().int().min(1).describe('ID of the story or comment to reply to'),
    text: z
      .string()
      .min(1)
      .describe(
        'Comment text (supports HN formatting: blank line for paragraphs, * for italics, indented code blocks)',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the comment was submitted successfully'),
  }),
  handle: async params => {
    await submitComment(params.parent_id, params.text);
    return { success: true };
  },
});
