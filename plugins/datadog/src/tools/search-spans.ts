import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';
import { spanSchema, mapSpan } from './schemas.js';

export const searchSpans = defineTool({
  name: 'search_spans',
  displayName: 'Search Spans',
  description:
    'Search APM spans/traces using Datadog query syntax. Filter by service, resource, operation, status, duration, and tags (e.g., "service:web-store", "@http.status_code:500", "@duration:>5000000").',
  summary: 'Search APM spans with Datadog query syntax',
  icon: 'activity',
  group: 'APM',
  input: z.object({
    query: z.string().describe('Span search query (e.g., "service:my-app status:error", "@duration:>1000000")'),
    from: z.string().optional().describe('Start time (default now-1h)'),
    to: z.string().optional().describe('End time (default now)'),
    limit: z.number().int().min(1).max(50).optional().describe('Maximum spans (default 25, max 50)'),
    sort: z.enum(['timestamp', '-timestamp']).optional().describe('Sort order (default -timestamp)'),
  }),
  output: z.object({
    spans: z.array(spanSchema),
  }),
  handle: async params => {
    const data = await apiPost<{ data?: Array<Record<string, unknown>> }>('/api/v2/spans/events/search', {
      data: {
        type: 'search_request',
        attributes: {
          filter: {
            query: params.query,
            from: params.from ?? 'now-1h',
            to: params.to ?? 'now',
          },
          sort: params.sort ?? '-timestamp',
          page: { limit: params.limit ?? 25 },
        },
      },
    });
    return { spans: (data.data ?? []).map(mapSpan) };
  },
});
