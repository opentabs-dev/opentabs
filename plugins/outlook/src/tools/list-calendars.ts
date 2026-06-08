import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { type RawCalendar, calendarSchema, mapCalendar } from './calendar-schemas.js';

export const listCalendars = defineTool({
  name: 'list_calendars',
  displayName: 'List Calendars',
  description:
    "List the user's calendars, including the default calendar and any shared calendars added to their account. Use a calendar's ID with list_events or get_calendar_view to read a specific calendar.",
  summary: 'List calendars',
  icon: 'calendar',
  group: 'Calendar',
  input: z.object({}),
  output: z.object({
    calendars: z.array(calendarSchema).describe('Calendars available to the user'),
  }),
  handle: async () => {
    const data = await api<{ value: RawCalendar[] }>(
      '/me/calendars',
      {
        query: {
          $select: 'id,name,color,hexColor,isDefaultCalendar,canEdit,canShare,canViewPrivateItems,owner',
          $top: 50,
        },
      },
      'calendar',
    );
    return { calendars: (data.value ?? []).map(mapCalendar) };
  },
});
