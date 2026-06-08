import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import {
  EVENT_DETAIL_FIELDS,
  type RawEvent,
  attendeeInputSchema,
  buildAttendees,
  buildDateTime,
  eventDetailSchema,
  mapEventDetail,
} from './calendar-schemas.js';

export const createEvent = defineTool({
  name: 'create_event',
  displayName: 'Create Event',
  description:
    'Create a calendar event or meeting. Add attendees to send invitations. Set is_online_meeting to attach a Teams meeting link. Times are interpreted as UTC unless a time_zone is supplied.',
  summary: 'Create a calendar event',
  icon: 'calendar-plus',
  group: 'Calendar',
  input: z.object({
    subject: z.string().describe('Event subject/title'),
    start: z.iso
      .datetime({ offset: false, local: true })
      .describe('Start as ISO 8601 without an offset (e.g. "2026-06-02T13:00:00"); the zone is set by time_zone.'),
    end: z.iso
      .datetime({ offset: false, local: true })
      .describe('End as ISO 8601 without an offset (e.g. "2026-06-02T14:00:00"); the zone is set by time_zone.'),
    time_zone: z
      .string()
      .optional()
      .describe('Time zone for start/end (e.g. "Eastern Standard Time"). Defaults to UTC.'),
    body: z.string().optional().describe('Event body/description'),
    body_type: z.enum(['text', 'html']).optional().describe('Body content type (default: text)'),
    location: z.string().optional().describe('Location display name'),
    attendees: z.array(attendeeInputSchema).optional().describe('Attendees to invite'),
    is_all_day: z.boolean().optional().describe('All-day event. When true, start/end must be at midnight.'),
    is_online_meeting: z.boolean().optional().describe('Attach an online (Teams) meeting'),
    importance: z.enum(['low', 'normal', 'high']).optional().describe('Importance level'),
    show_as: z
      .enum(['free', 'tentative', 'busy', 'oof', 'workingElsewhere'])
      .optional()
      .describe('Free/busy status to show (default: busy)'),
    reminder_minutes_before_start: z.number().int().min(0).optional().describe('Reminder lead time in minutes'),
    calendar_id: z.string().optional().describe('Calendar to create the event in. Defaults to the primary calendar.'),
  }),
  output: z.object({
    event: eventDetailSchema.describe('The created event'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      subject: params.subject,
      start: buildDateTime(params.start, params.time_zone),
      end: buildDateTime(params.end, params.time_zone),
    };
    if (params.body !== undefined) {
      body.body = { contentType: params.body_type === 'html' ? 'HTML' : 'Text', content: params.body };
    }
    if (params.location !== undefined) body.location = { displayName: params.location };
    if (params.attendees) body.attendees = buildAttendees(params.attendees);
    if (params.is_all_day !== undefined) body.isAllDay = params.is_all_day;
    if (params.is_online_meeting !== undefined) body.isOnlineMeeting = params.is_online_meeting;
    if (params.importance !== undefined) body.importance = params.importance;
    if (params.show_as !== undefined) body.showAs = params.show_as;
    if (params.reminder_minutes_before_start !== undefined) {
      body.reminderMinutesBeforeStart = params.reminder_minutes_before_start;
      body.isReminderOn = true;
    }

    const endpoint = params.calendar_id
      ? `/me/calendars/${encodeURIComponent(params.calendar_id)}/events`
      : '/me/events';
    const created = await api<RawEvent>(
      endpoint,
      { method: 'POST', body, query: { $select: EVENT_DETAIL_FIELDS } },
      'calendar-write',
    );
    return { event: mapEventDetail(created) };
  },
});
