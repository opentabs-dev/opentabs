import { z } from 'zod';
import { type RawEmailAddress, emailAddressSchema, mapEmailAddress } from './schemas.js';

// ── Date / time ───────────────────────────────────────────────────────────

export const dateTimeZoneSchema = z.object({
  date_time: z.string().describe('Local date-time in ISO 8601 without offset (e.g. "2026-06-02T13:00:00")'),
  time_zone: z.string().describe('Time zone name (e.g. "UTC", "Eastern Standard Time")'),
});

export interface RawDateTimeZone {
  dateTime?: string;
  timeZone?: string;
}

export const mapDateTimeZone = (d: RawDateTimeZone | undefined | null) => ({
  date_time: d?.dateTime ?? '',
  time_zone: d?.timeZone ?? '',
});

// ── Attendee ───────────────────────────────────────────────────────────────

export const attendeeSchema = z.object({
  name: z.string().describe('Attendee display name'),
  address: z.string().describe('Attendee email address'),
  type: z.string().describe('Attendance type (required, optional, resource)'),
  response: z
    .string()
    .describe('Response status (none, accepted, declined, tentativelyAccepted, notResponded, organizer)'),
});

export interface RawAttendee extends RawEmailAddress {
  type?: string;
  status?: { response?: string; time?: string };
}

export const mapAttendee = (a: RawAttendee) => {
  const { name, address } = mapEmailAddress(a);
  return {
    name,
    address,
    type: a.type ?? 'required',
    response: a.status?.response ?? 'none',
  };
};

// ── Calendar ───────────────────────────────────────────────────────────────

export const calendarSchema = z.object({
  id: z.string().describe('Calendar ID'),
  name: z.string().describe('Calendar display name'),
  color: z.string().describe('Color preset name (auto, lightBlue, lightGreen, ...)'),
  hex_color: z.string().describe('Color as a hex string when available'),
  is_default: z.boolean().describe('Whether this is the default calendar'),
  can_edit: z.boolean().describe('Whether the user can edit events in this calendar'),
  can_share: z.boolean().describe('Whether the user can share this calendar'),
  can_view_private_items: z.boolean().describe('Whether the user can view private events'),
  owner: emailAddressSchema.describe('Calendar owner'),
});

export interface RawCalendar {
  id?: string;
  name?: string;
  color?: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  canShare?: boolean;
  canViewPrivateItems?: boolean;
  owner?: { name?: string; address?: string };
}

export const mapCalendar = (c: RawCalendar) => ({
  id: c.id ?? '',
  name: c.name ?? '',
  color: c.color ?? 'auto',
  hex_color: c.hexColor ?? '',
  is_default: c.isDefaultCalendar ?? false,
  can_edit: c.canEdit ?? false,
  can_share: c.canShare ?? false,
  can_view_private_items: c.canViewPrivateItems ?? false,
  owner: {
    name: c.owner?.name ?? '',
    address: c.owner?.address ?? '',
  },
});

// ── Event ──────────────────────────────────────────────────────────────────

export const eventSummarySchema = z.object({
  id: z.string().describe('Event ID'),
  subject: z.string().describe('Event subject/title'),
  start: dateTimeZoneSchema.describe('Start date-time'),
  end: dateTimeZoneSchema.describe('End date-time'),
  is_all_day: z.boolean().describe('Whether the event lasts all day'),
  location: z.string().describe('Primary location display name'),
  organizer: emailAddressSchema.describe('Event organizer'),
  is_cancelled: z.boolean().describe('Whether the event has been cancelled'),
  show_as: z.string().describe('Free/busy status (free, tentative, busy, oof, workingElsewhere, unknown)'),
  is_online_meeting: z.boolean().describe('Whether the event is an online meeting'),
  online_meeting_url: z.string().describe('Join URL for the online meeting, if any'),
  type: z.string().describe('Event type (singleInstance, occurrence, exception, seriesMaster)'),
  response_status: z
    .string()
    .describe("The current user's response (none, accepted, declined, tentativelyAccepted, organizer, notResponded)"),
  web_link: z.string().describe('Link to open the event in Outlook on the web'),
  preview: z.string().describe('Body preview text'),
});

export const eventDetailSchema = eventSummarySchema.extend({
  body_type: z.string().describe('Body content type (text or html)'),
  body: z.string().describe('Full event body'),
  attendees: z.array(attendeeSchema).describe('Event attendees and their responses'),
  importance: z.string().describe('Importance level (low, normal, high)'),
  sensitivity: z.string().describe('Sensitivity (normal, personal, private, confidential)'),
  categories: z.array(z.string()).describe('Categories/labels'),
  is_reminder_on: z.boolean().describe('Whether a reminder is set'),
  reminder_minutes_before_start: z.number().describe('Minutes before start the reminder fires'),
  has_attachments: z.boolean().describe('Whether the event has attachments'),
  response_requested: z.boolean().describe('Whether the organizer requested a response'),
  series_master_id: z.string().describe('ID of the series master, for occurrences/exceptions'),
  is_recurring: z.boolean().describe('Whether the event is part of a recurring series'),
  created_at: z.string().describe('Creation datetime (ISO 8601)'),
  last_modified_at: z.string().describe('Last modified datetime (ISO 8601)'),
});

export interface RawEvent {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  start?: RawDateTimeZone;
  end?: RawDateTimeZone;
  isAllDay?: boolean;
  location?: { displayName?: string };
  organizer?: RawEmailAddress;
  attendees?: RawAttendee[];
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
  showAs?: string;
  type?: string;
  responseStatus?: { response?: string; time?: string };
  importance?: string;
  sensitivity?: string;
  categories?: string[];
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
  hasAttachments?: boolean;
  responseRequested?: boolean;
  seriesMasterId?: string;
  recurrence?: unknown;
  webLink?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

export const mapEventSummary = (e: RawEvent) => ({
  id: e.id ?? '',
  subject: e.subject ?? '(no subject)',
  start: mapDateTimeZone(e.start),
  end: mapDateTimeZone(e.end),
  is_all_day: e.isAllDay ?? false,
  location: e.location?.displayName ?? '',
  organizer: mapEmailAddress(e.organizer ?? {}),
  is_cancelled: e.isCancelled ?? false,
  show_as: e.showAs ?? 'unknown',
  is_online_meeting: e.isOnlineMeeting ?? false,
  online_meeting_url: e.onlineMeeting?.joinUrl ?? '',
  type: e.type ?? 'singleInstance',
  response_status: e.responseStatus?.response ?? 'none',
  web_link: e.webLink ?? '',
  preview: e.bodyPreview ?? '',
});

export const mapEventDetail = (e: RawEvent) => ({
  ...mapEventSummary(e),
  body_type: e.body?.contentType ?? 'text',
  body: e.body?.content ?? '',
  attendees: (e.attendees ?? []).map(mapAttendee),
  importance: e.importance ?? 'normal',
  sensitivity: e.sensitivity ?? 'normal',
  categories: e.categories ?? [],
  is_reminder_on: e.isReminderOn ?? false,
  reminder_minutes_before_start: e.reminderMinutesBeforeStart ?? 0,
  has_attachments: e.hasAttachments ?? false,
  response_requested: e.responseRequested ?? false,
  series_master_id: e.seriesMasterId ?? '',
  is_recurring: Boolean(e.recurrence) || e.type === 'seriesMaster' || e.type === 'occurrence' || e.type === 'exception',
  created_at: e.createdDateTime ?? '',
  last_modified_at: e.lastModifiedDateTime ?? '',
});

// ── Request-body builders (create / update) ─────────────────────────────────

/** Build a Graph/REST dateTimeTimeZone object. Times default to UTC when no zone given. */
export const buildDateTime = (dateTime: string, timeZone?: string) => ({
  dateTime,
  timeZone: timeZone ?? 'UTC',
});

/** Attendee shape accepted by create_event / update_event input. */
export const attendeeInputSchema = z.object({
  address: z.string().describe('Attendee email address'),
  name: z.string().optional().describe('Attendee display name'),
  type: z.enum(['required', 'optional', 'resource']).optional().describe('Attendance type (default: required)'),
});

export interface AttendeeInput {
  address: string;
  name?: string;
  type?: 'required' | 'optional' | 'resource';
}

/** Build the attendees array for an event request body. */
export const buildAttendees = (attendees: AttendeeInput[]) =>
  attendees.map(a => ({
    emailAddress: { address: a.address, name: a.name },
    type: a.type ?? 'required',
  }));

// ── Schedule (free/busy) ─────────────────────────────────────────────────

export const scheduleItemSchema = z.object({
  status: z.string().describe('Free/busy status (free, tentative, busy, oof, workingElsewhere, unknown)'),
  start: dateTimeZoneSchema.describe('Slot start'),
  end: dateTimeZoneSchema.describe('Slot end'),
  subject: z.string().describe('Subject, when visible to the requester'),
  location: z.string().describe('Location, when visible'),
  is_private: z.boolean().describe('Whether the item is marked private'),
  is_meeting: z.boolean().describe('Whether the item is a meeting'),
  is_recurring: z.boolean().describe('Whether the item recurs'),
});

export const workingHoursSchema = z.object({
  days_of_week: z.array(z.string()).describe('Working days'),
  start_time: z.string().describe('Work day start time'),
  end_time: z.string().describe('Work day end time'),
  time_zone: z.string().describe('Working-hours time zone name'),
});

export const scheduleSchema = z.object({
  schedule_id: z.string().describe('The email address this schedule belongs to'),
  availability_view: z
    .string()
    .describe('Per-interval availability string: 0=free, 1=tentative, 2=busy, 3=oof, 4=workingElsewhere'),
  items: z.array(scheduleItemSchema).describe('Busy/tentative/oof time blocks in the requested window'),
  working_hours: workingHoursSchema.nullable().describe('Working hours, when available'),
  error: z.string().describe('Error message for this schedule, if the lookup failed'),
});

export interface RawScheduleItem {
  status?: string;
  start?: RawDateTimeZone;
  end?: RawDateTimeZone;
  subject?: string;
  location?: string;
  isPrivate?: boolean;
  isMeeting?: boolean;
  isRecurring?: boolean;
}

export interface RawSchedule {
  scheduleId?: string;
  availabilityView?: string;
  scheduleItems?: RawScheduleItem[];
  workingHours?: {
    daysOfWeek?: string[];
    startTime?: string;
    endTime?: string;
    timeZone?: { name?: string };
  };
  error?: { message?: string; responseCode?: string };
}

export const mapSchedule = (s: RawSchedule) => ({
  schedule_id: s.scheduleId ?? '',
  availability_view: s.availabilityView ?? '',
  items: (s.scheduleItems ?? []).map(item => ({
    status: item.status ?? 'unknown',
    start: mapDateTimeZone(item.start),
    end: mapDateTimeZone(item.end),
    subject: item.subject ?? '',
    location: item.location ?? '',
    is_private: item.isPrivate ?? false,
    is_meeting: item.isMeeting ?? false,
    is_recurring: item.isRecurring ?? false,
  })),
  working_hours: s.workingHours
    ? {
        days_of_week: s.workingHours.daysOfWeek ?? [],
        start_time: s.workingHours.startTime ?? '',
        end_time: s.workingHours.endTime ?? '',
        time_zone: s.workingHours.timeZone?.name ?? '',
      }
    : null,
  error: s.error?.message ?? '',
});

// ── Shared field lists for $select ──────────────────────────────────────────

export const EVENT_SUMMARY_FIELDS =
  'id,subject,start,end,isAllDay,location,organizer,isCancelled,showAs,isOnlineMeeting,onlineMeeting,type,responseStatus,webLink,bodyPreview';

export const EVENT_DETAIL_FIELDS = `${EVENT_SUMMARY_FIELDS},body,attendees,importance,sensitivity,categories,isReminderOn,reminderMinutesBeforeStart,hasAttachments,responseRequested,seriesMasterId,recurrence,createdDateTime,lastModifiedDateTime`;
