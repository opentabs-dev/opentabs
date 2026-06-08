import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { EVENT_SUMMARY_FIELDS, type RawEvent, eventSummarySchema, mapEventSummary } from './calendar-schemas.js';

export const getCalendarView = defineTool({
  name: 'get_calendar_view',
  displayName: 'Get Calendar View',
  description:
    'Get the events occurring within a date/time range, with recurring series expanded into individual occurrences. This is the tool to answer "what is on my calendar" for a given day, week, or range. The range bounds are read from the offset in the start/end timestamps (UTC when no offset is given); time_zone only controls the zone of the returned event times.',
  summary: 'View events in a date range',
  icon: 'calendar-clock',
  group: 'Calendar',
  input: z.object({
    start: z.iso
      .datetime({ offset: true, local: true })
      .describe(
        'Range start as ISO 8601. Include a UTC offset to anchor the zone (e.g. "2026-06-02T00:00:00-04:00"); without an offset it is treated as UTC.',
      ),
    end: z.iso
      .datetime({ offset: true, local: true })
      .describe(
        'Range end as ISO 8601. Include a UTC offset to anchor the zone (e.g. "2026-06-09T00:00:00-04:00"); without an offset it is treated as UTC.',
      ),
    calendar_id: z
      .string()
      .optional()
      .describe('Calendar ID to read (from list_calendars). Defaults to the primary calendar.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max occurrences to return (default 50, max 100)'),
    time_zone: z
      .string()
      .optional()
      .describe(
        'Time zone for the returned event start/end times, e.g. "Eastern Standard Time" (does not shift the range bounds). Defaults to UTC.',
      ),
  }),
  output: z.object({
    events: z.array(eventSummarySchema).describe('Event occurrences within the range, ordered by start time'),
  }),
  handle: async params => {
    const base = params.calendar_id ? `/me/calendars/${encodeURIComponent(params.calendar_id)}` : '/me';
    const data = await api<{ value: RawEvent[] }>(
      `${base}/calendarView`,
      {
        query: {
          startDateTime: params.start,
          endDateTime: params.end,
          $select: EVENT_SUMMARY_FIELDS,
          $orderby: 'start/dateTime',
          $top: params.limit ?? 50,
        },
        headers: params.time_zone ? { Prefer: `outlook.timezone="${params.time_zone}"` } : undefined,
      },
      'calendar',
    );
    return { events: (data.value ?? []).map(mapEventSummary) };
  },
});
