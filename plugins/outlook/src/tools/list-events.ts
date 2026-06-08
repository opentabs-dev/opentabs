import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { EVENT_SUMMARY_FIELDS, type RawEvent, eventSummarySchema, mapEventSummary } from './calendar-schemas.js';

export const listEvents = defineTool({
  name: 'list_events',
  displayName: 'List Events',
  description:
    'List calendar events from a calendar (defaults to the primary calendar). Returns events as stored — recurring series appear as a single series master, not expanded into occurrences. To see what actually falls within a date range (with recurrences expanded), use get_calendar_view instead.',
  summary: 'List calendar events',
  icon: 'calendar',
  group: 'Calendar',
  input: z.object({
    calendar_id: z
      .string()
      .optional()
      .describe('Calendar ID to read (from list_calendars). Defaults to the primary calendar.'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10, max 50)'),
    skip: z.number().int().min(0).optional().describe('Number of events to skip for pagination'),
    filter: z.string().optional().describe('OData $filter expression (e.g. "isCancelled eq false")'),
    time_zone: z
      .string()
      .optional()
      .describe(
        'IANA or Windows time zone to return start/end times in (e.g. "Eastern Standard Time"). Defaults to UTC.',
      ),
  }),
  output: z.object({
    events: z.array(eventSummarySchema).describe('Calendar events'),
    total_count: z.number().optional().describe('Total count if available'),
  }),
  handle: async params => {
    const endpoint = params.calendar_id
      ? `/me/calendars/${encodeURIComponent(params.calendar_id)}/events`
      : '/me/events';
    const data = await api<{ value: RawEvent[]; '@odata.count'?: number }>(
      endpoint,
      {
        query: {
          $select: EVENT_SUMMARY_FIELDS,
          $orderby: 'start/dateTime',
          $top: params.limit ?? 10,
          $skip: params.skip,
          $filter: params.filter,
          $count: true,
        },
        headers: {
          ConsistencyLevel: 'eventual',
          ...(params.time_zone ? { Prefer: `outlook.timezone="${params.time_zone}"` } : {}),
        },
      },
      'calendar',
    );
    return {
      events: (data.value ?? []).map(mapEventSummary),
      total_count: data['@odata.count'],
    };
  },
});
