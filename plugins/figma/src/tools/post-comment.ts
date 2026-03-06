import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi } from '../figma-api.js';
import type { RawComment } from './schemas.js';
import { commentSchema, mapComment } from './schemas.js';

export const postComment = defineTool({
  name: 'post_comment',
  displayName: 'Post Comment',
  description: 'Add a comment to a Figma file. Comments are visible to all collaborators.',
  summary: 'Add a comment to a file',
  icon: 'message-square-plus',
  group: 'Comments',
  input: z.object({
    file_key: z.string().min(1).describe('File key to comment on'),
    message: z.string().min(1).describe('Comment text to post'),
  }),
  output: z.object({
    comment: commentSchema.describe('The created comment'),
  }),
  handle: async params => {
    const data = await figmaApi<{ meta?: RawComment }>(`/file/${params.file_key}/comments`, {
      method: 'POST',
      body: {
        message: params.message,
        client_meta: { x: 0, y: 0 },
        message_meta: { type: 'text' },
      },
    });
    return { comment: mapComment(data.meta ?? {}) };
  },
});
