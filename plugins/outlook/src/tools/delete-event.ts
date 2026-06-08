import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

export const deleteEvent = defineTool({
  name: 'delete_event',
  displayName: 'Delete Event',
  description:
    'Delete or cancel a calendar event. For a meeting you organize, provide a cancellation_message to send a cancellation notice to all attendees. Without a cancellation_message the event is simply removed from your calendar.',
  summary: 'Delete or cancel an event',
  icon: 'calendar-x',
  group: 'Calendar',
  input: z.object({
    event_id: z.string().describe('The event ID to delete or cancel'),
    cancellation_message: z
      .string()
      .optional()
      .describe(
        'When set and you are the organizer, sends this cancellation note to attendees instead of a silent delete.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the event was deleted or cancelled'),
    cancelled: z.boolean().describe('True if a cancellation notice was sent to attendees, false for a silent delete'),
  }),
  handle: async params => {
    const eventId = encodeURIComponent(params.event_id);
    if (params.cancellation_message !== undefined) {
      await api(
        `/me/events/${eventId}/cancel`,
        { method: 'POST', body: { comment: params.cancellation_message } },
        'calendar-write',
      );
      return { success: true, cancelled: true };
    }
    await api(`/me/events/${eventId}`, { method: 'DELETE' }, 'calendar-write');
    return { success: true, cancelled: false };
  },
});
