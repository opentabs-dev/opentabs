import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import { type RawMatch, type RawMessage, mapMatch, mapMessage, matchSchema, messageSchema } from './schemas.js';

interface UpdatesResponse {
  matches: RawMatch[];
  blocks: string[];
  last_activity_date: string;
}

export const getUpdates = defineTool({
  name: 'get_updates',
  displayName: 'Get Updates',
  description:
    'Get recent activity updates including new matches, messages, and blocks since a given date. Pass an empty string for last_activity_date to get all recent updates.',
  summary: 'Get recent activity updates',
  icon: 'bell',
  group: 'Account',
  input: z.object({
    last_activity_date: z.string().optional().describe('ISO 8601 date to get updates since, empty for all recent'),
  }),
  output: z.object({
    matches: z.array(matchSchema).describe('New or updated matches'),
    new_messages: z.array(messageSchema).describe('New messages across all matches'),
  }),
  handle: async params => {
    const data = await api<UpdatesResponse>('/updates', {
      method: 'POST',
      body: {
        nudge: false,
        last_activity_date: params.last_activity_date ?? '',
      },
    });

    const matches = (data.matches ?? []).map(mapMatch);

    const newMessages = (data.matches ?? []).flatMap(m => (m.messages ?? []).map((msg: RawMessage) => mapMessage(msg)));

    return {
      matches,
      new_messages: newMessages,
    };
  },
});
