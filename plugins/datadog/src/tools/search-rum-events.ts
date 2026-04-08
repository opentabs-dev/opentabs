import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const searchRumEvents = defineTool({
  name: 'search_rum_events',
  displayName: 'Search RUM Events',
  description:
    'Search Real User Monitoring (RUM) events. Filter by event type, user, URL, browser, and more using Datadog query syntax (e.g., "@type:error", "@view.url:*/checkout/*", "@usr.id:user123").',
  summary: 'Search RUM events with query syntax',
  icon: 'globe',
  group: 'RUM',
  input: z.object({
    query: z.string().describe('RUM search query (e.g., "@type:error", "@type:view @view.loading_time:>5000")'),
    from: z.string().optional().describe('Start time (default now-15m)'),
    to: z.string().optional().describe('End time (default now)'),
    limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default 25)'),
    sort: z.enum(['timestamp', '-timestamp']).optional().describe('Sort order'),
  }),
  output: z.object({
    events: z.array(
      z.object({
        id: z.string().describe('Event ID'),
        type: z.string().describe('Event type (session, view, action, error, resource, long_task)'),
        timestamp: z.string().describe('Event timestamp'),
        attributes: z.unknown().describe('Event attributes'),
      }),
    ),
  }),
  handle: async params => {
    const data = await apiPost<{ data?: Array<Record<string, unknown>> }>('/api/v2/rum/events/search', {
      filter: {
        query: params.query,
        from: params.from ?? 'now-15m',
        to: params.to ?? 'now',
      },
      sort: params.sort ?? '-timestamp',
      page: { limit: params.limit ?? 25 },
    });
    const events = (data.data ?? []).map(e => ({
      id: (e.id as string) ?? '',
      type: (e.type as string) ?? '',
      timestamp: ((e.attributes as Record<string, unknown>)?.timestamp as string) ?? '',
      attributes: e.attributes ?? {},
    }));
    return { events };
  },
});
