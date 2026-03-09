import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiDirect } from '../tinder-api.js';

export const passUser = defineTool({
  name: 'pass_user',
  displayName: 'Pass User',
  description: 'Pass (swipe left on) a user, skipping them from recommendations.',
  summary: 'Pass on a user',
  icon: 'x',
  group: 'Discovery',
  input: z.object({
    user_id: z.string().describe('User ID to pass on'),
    content_hash: z.string().describe('Content hash from get_recommendations').optional(),
    s_number: z.number().describe('S number from get_recommendations').optional(),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the pass was recorded successfully'),
  }),
  handle: async params => {
    await apiDirect(`/pass/${params.user_id}`, {
      query: {
        content_hash: params.content_hash,
        s_number: params.s_number,
      },
    });

    return { success: true };
  },
});
