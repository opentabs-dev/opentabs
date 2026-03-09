import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';

export const unmatch = defineTool({
  name: 'unmatch',
  displayName: 'Unmatch',
  description: 'Unmatch a person, removing them from your matches list. This action cannot be undone.',
  summary: 'Remove a match',
  icon: 'user-x',
  group: 'Matches',
  input: z.object({
    match_id: z.string().describe('Match ID to unmatch'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unmatch was successful'),
  }),
  handle: async params => {
    await api(`/user/matches/${params.match_id}`, { method: 'DELETE' });
    return { success: true };
  },
});
