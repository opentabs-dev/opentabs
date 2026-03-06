import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getOrgSlug, sentryApi } from '../sentry-api.js';

export const getEvent = defineTool({
  name: 'get_event',
  displayName: 'Get Event',
  description:
    'Get full details of a specific event including stack trace, breadcrumbs, tags, context, and more. ' +
    'Requires the project slug and event ID.',
  summary: 'Get full details of a specific event',
  icon: 'file-text',
  group: 'Issues',
  input: z.object({
    project_slug: z.string().describe('Project slug the event belongs to'),
    event_id: z.string().describe('The event ID to retrieve'),
  }),
  output: z.object({
    event: z
      .object({
        id: z.string().describe('Event ID'),
        event_id: z.string().describe('Event UUID'),
        title: z.string().describe('Event title'),
        message: z.string().describe('Event message'),
        platform: z.string().describe('Platform (e.g., python, javascript)'),
        date_created: z.string().describe('ISO 8601 timestamp when the event occurred'),
        context: z.string().describe('JSON string of the event context data'),
        tags: z
          .array(z.object({ key: z.string().describe('Tag key'), value: z.string().describe('Tag value') }))
          .describe('Event tags'),
        entries: z.string().describe('JSON string of event entries (exception, breadcrumbs, request, etc.)'),
      })
      .describe('Full event details'),
  }),
  handle: async params => {
    const orgSlug = getOrgSlug();
    const data = await sentryApi<Record<string, unknown>>(
      `/projects/${orgSlug}/${params.project_slug}/events/${params.event_id}/`,
    );
    const rawTags = (data.tags as Array<Record<string, unknown>>) ?? [];
    const context = data.context ?? data.contexts ?? {};
    const entries = data.entries ?? [];

    return {
      event: {
        id: (data.id as string) ?? '',
        event_id: (data.eventID as string) ?? (data.id as string) ?? '',
        title: (data.title as string) ?? '',
        message: (data.message as string) ?? '',
        platform: (data.platform as string) ?? '',
        date_created: (data.dateCreated as string) ?? '',
        context: JSON.stringify(context).substring(0, 10000),
        tags: rawTags.map(t => ({
          key: (t.key as string) ?? '',
          value: (t.value as string) ?? '',
        })),
        entries: JSON.stringify(entries).substring(0, 20000),
      },
    };
  },
});
