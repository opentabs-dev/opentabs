import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

const RESPONSE_ACTION: Record<string, string> = {
  accept: 'accept',
  decline: 'decline',
  tentative: 'tentativelyAccept',
};

export const respondToEvent = defineTool({
  name: 'respond_to_event',
  displayName: 'Respond to Event',
  description:
    'Respond to a meeting invitation by accepting, declining, or tentatively accepting. Optionally include a comment and choose whether to send a response back to the organizer.',
  summary: 'Accept, decline, or tentatively accept',
  icon: 'calendar-check',
  group: 'Calendar',
  input: z.object({
    event_id: z.string().describe('The event ID of the meeting invitation'),
    response: z.enum(['accept', 'decline', 'tentative']).describe('Your response to the invitation'),
    comment: z.string().optional().describe('Optional comment to include with the response'),
    send_response: z.boolean().optional().describe('Whether to send the response to the organizer (default: true)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the response was recorded'),
  }),
  handle: async params => {
    const action = RESPONSE_ACTION[params.response];
    await api(
      `/me/events/${encodeURIComponent(params.event_id)}/${action}`,
      {
        method: 'POST',
        body: {
          comment: params.comment,
          sendResponse: params.send_response ?? true,
        },
      },
      'calendar-write',
    );
    return { success: true };
  },
});
