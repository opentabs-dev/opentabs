import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { EVENT_DETAIL_FIELDS, type RawEvent, eventDetailSchema, mapEventDetail } from './calendar-schemas.js';

export const getEvent = defineTool({
  name: 'get_event',
  displayName: 'Get Event',
  description:
    'Get the full details of a single calendar event, including body, attendees and their responses, location, reminders, and recurrence status.',
  summary: 'Get event details',
  icon: 'calendar',
  group: 'Calendar',
  input: z.object({
    event_id: z.string().describe('The event ID (from list_events or get_calendar_view)'),
    time_zone: z
      .string()
      .optional()
      .describe('Time zone to return start/end times in (e.g. "Eastern Standard Time"). Defaults to UTC.'),
  }),
  output: z.object({
    event: eventDetailSchema.describe('The event'),
  }),
  handle: async params => {
    const data = await api<RawEvent>(
      `/me/events/${encodeURIComponent(params.event_id)}`,
      {
        query: { $select: EVENT_DETAIL_FIELDS },
        headers: params.time_zone ? { Prefer: `outlook.timezone="${params.time_zone}"` } : undefined,
      },
      'calendar',
    );
    return { event: mapEventDetail(data) };
  },
});
