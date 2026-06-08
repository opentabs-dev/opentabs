import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { type RawSchedule, mapSchedule, scheduleSchema } from './calendar-schemas.js';

export const getSchedule = defineTool({
  name: 'get_schedule',
  displayName: 'Get Schedule',
  description:
    "Look up free/busy availability for one or more people in the organization over a time window. Returns each person's busy/tentative/out-of-office blocks (with subjects and locations where the requester is permitted to see them) and their working hours. Use this to view other people's calendars and find open meeting times.",
  summary: "View others' availability",
  icon: 'users',
  group: 'Calendar',
  input: z.object({
    schedules: z.array(z.string()).min(1).describe('Email addresses of the people (or rooms) to look up'),
    start: z.iso
      .datetime({ offset: false, local: true })
      .describe(
        'Window start as ISO 8601 without an offset (e.g. "2026-06-02T08:00:00"); the zone is set by time_zone.',
      ),
    end: z.iso
      .datetime({ offset: false, local: true })
      .describe('Window end as ISO 8601 without an offset (e.g. "2026-06-02T18:00:00"); the zone is set by time_zone.'),
    time_zone: z
      .string()
      .optional()
      .describe('Time zone for the window and returned times (e.g. "Eastern Standard Time"). Defaults to UTC.'),
    interval_minutes: z
      .number()
      .int()
      .min(5)
      .max(1440)
      .optional()
      .describe('Granularity of the availability view in minutes (default 30)'),
  }),
  output: z.object({
    schedules: z.array(scheduleSchema).describe('Per-person availability'),
  }),
  handle: async params => {
    const tz = params.time_zone ?? 'UTC';
    const data = await api<{ value: RawSchedule[] }>(
      '/me/calendar/getSchedule',
      {
        method: 'POST',
        body: {
          schedules: params.schedules,
          startTime: { dateTime: params.start, timeZone: tz },
          endTime: { dateTime: params.end, timeZone: tz },
          availabilityViewInterval: params.interval_minutes ?? 30,
        },
        headers: { Prefer: `outlook.timezone="${tz}"` },
      },
      'calendar',
    );
    return { schedules: (data.value ?? []).map(mapSchedule) };
  },
});
