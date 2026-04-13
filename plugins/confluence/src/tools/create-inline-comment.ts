import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawInlineComment, inlineCommentSchema, mapInlineComment } from './schemas.js';

export const createInlineComment = defineTool({
  name: 'create_inline_comment',
  displayName: 'Create Inline Comment',
  description:
    'Create an inline comment on specific text in a Confluence page. The comment is anchored to the selected text and appears as a margin note. Provide the exact text to anchor to, the total number of matches of that text on the page, and which match (0-based index) to anchor to.',
  summary: 'Create an inline comment on page text',
  icon: 'message-square-quote',
  group: 'Comments',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to create the inline comment on'),
    body: z.string().min(1).describe('Comment body in storage format (HTML) — e.g., "<p>This needs clarification</p>"'),
    text_selection: z.string().min(1).describe('The exact text in the page to anchor the comment to'),
    text_selection_match_count: z
      .number()
      .int()
      .min(1)
      .describe('Total number of times the selected text appears on the page'),
    text_selection_match_index: z
      .number()
      .int()
      .min(0)
      .describe('Which occurrence of the text to anchor to (0-based index)'),
  }),
  output: z.object({
    comment: inlineCommentSchema.describe('The created inline comment'),
  }),
  handle: async params => {
    const data = await apiV2<RawInlineComment>('/inline-comments', {
      method: 'POST',
      body: {
        pageId: params.page_id,
        body: {
          representation: 'storage',
          value: params.body,
        },
        inlineCommentProperties: {
          textSelection: params.text_selection,
          textSelectionMatchCount: params.text_selection_match_count,
          textSelectionMatchIndex: params.text_selection_match_index,
        },
      },
    });

    return { comment: mapInlineComment(data) };
  },
});
