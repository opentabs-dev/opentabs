import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
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

export const updateEvent = defineTool({
  name: 'update_event',
  displayName: 'Update Event',
  description:
    'Update properties of an existing calendar event. Only the fields you provide are changed. Updating the attendees of a meeting you organize sends updated invitations. To change start/end times, provide both start and end.',
  summary: 'Update a calendar event',
  icon: 'pencil',
  group: 'Calendar',
  input: z.object({
    event_id: z.string().describe('The event ID to update'),
    subject: z.string().optional().describe('New subject/title'),
    start: z.iso
      .datetime({ offset: false, local: true })
      .optional()
      .describe('New start as ISO 8601 without an offset; the zone is set by time_zone. Provide together with end.'),
    end: z.iso
      .datetime({ offset: false, local: true })
      .optional()
      .describe('New end as ISO 8601 without an offset; the zone is set by time_zone. Provide together with start.'),
    time_zone: z
      .string()
      .optional()
      .describe('Time zone for start/end (e.g. "Eastern Standard Time"). Defaults to UTC.'),
    body: z.string().optional().describe('New event body/description'),
    body_type: z.enum(['text', 'html']).optional().describe('Body content type (default: text)'),
    location: z.string().optional().describe('New location display name'),
    attendees: z.array(attendeeInputSchema).optional().describe('Replace the attendee list'),
    is_all_day: z.boolean().optional().describe('Mark as all-day. When true, start/end must be at midnight.'),
    is_online_meeting: z.boolean().optional().describe('Toggle an online (Teams) meeting'),
    importance: z.enum(['low', 'normal', 'high']).optional().describe('Importance level'),
    show_as: z
      .enum(['free', 'tentative', 'busy', 'oof', 'workingElsewhere'])
      .optional()
      .describe('Free/busy status to show'),
    reminder_minutes_before_start: z.number().int().min(0).optional().describe('Reminder lead time in minutes'),
    categories: z.array(z.string()).optional().describe('Set categories/labels'),
  }),
  output: z.object({
    event: eventDetailSchema.describe('The updated event'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.subject !== undefined) body.subject = params.subject;
    if (params.start !== undefined) body.start = buildDateTime(params.start, params.time_zone);
    if (params.end !== undefined) body.end = buildDateTime(params.end, params.time_zone);
    if (params.body !== undefined) {
      body.body = { contentType: params.body_type === 'html' ? 'HTML' : 'Text', content: params.body };
    }
    if (params.location !== undefined) body.location = { displayName: params.location };
    if (params.attendees !== undefined) body.attendees = buildAttendees(params.attendees);
    if (params.is_all_day !== undefined) body.isAllDay = params.is_all_day;
    if (params.is_online_meeting !== undefined) body.isOnlineMeeting = params.is_online_meeting;
    if (params.importance !== undefined) body.importance = params.importance;
    if (params.show_as !== undefined) body.showAs = params.show_as;
    if (params.reminder_minutes_before_start !== undefined) {
      body.reminderMinutesBeforeStart = params.reminder_minutes_before_start;
      body.isReminderOn = true;
    }
    if (params.categories !== undefined) body.categories = params.categories;

    if (Object.keys(body).length === 0) {
      throw ToolError.validation('Provide at least one field to update besides event_id.');
    }

    const updated = await api<RawEvent>(
      `/me/events/${encodeURIComponent(params.event_id)}`,
      { method: 'PATCH', body, query: { $select: EVENT_DETAIL_FIELDS } },
      'calendar-write',
    );
    return { event: mapEventDetail(updated) };
  },
});
