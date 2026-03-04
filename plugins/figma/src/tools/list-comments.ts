import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi } from '../figma-api.js';
import type { RawComment } from './schemas.js';
import { commentSchema, mapComment } from './schemas.js';

export const listComments = defineTool({
  name: 'list_comments',
  displayName: 'List Comments',
  description: 'List all comments on a Figma file',
  icon: 'message-square',
  group: 'Comments',
  input: z.object({
    file_key: z.string().min(1).describe('File key to list comments for'),
  }),
  output: z.object({
    comments: z.array(commentSchema).describe('Array of comments on the file'),
  }),
  handle: async params => {
    const data = await figmaApi<{ meta?: RawComment[] }>(`/file/${params.file_key}/comments`);
    const rawComments = Array.isArray(data.meta) ? data.meta : [];
    const comments = rawComments.map(mapComment);
    return { comments };
  },
});
