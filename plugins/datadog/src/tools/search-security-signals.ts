import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const searchSecuritySignals = defineTool({
  name: 'search_security_signals',
  displayName: 'Search Security Signals',
  description: 'Search security signals in Datadog Security Monitoring.',
  summary: 'Search security signals',
  icon: 'shield',
  group: 'Security',
  input: z.object({
    query: z
      .string()
      .optional()
      .describe('Search query for security signals (e.g., "status:high", "rule.name:*brute*")'),
    from: z.string().optional().describe('Start time — ISO 8601 or relative (e.g., "now-1h"). Default: now-1h'),
    to: z.string().optional().describe('End time — ISO 8601 or relative (e.g., "now"). Default: now'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum signals to return (default 25)'),
    sort: z.enum(['timestamp', '-timestamp']).optional().describe('Sort order (default -timestamp)'),
  }),
  output: z.object({
    signals: z.unknown().describe('Matching security signals'),
    meta: z.unknown().describe('Response metadata'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      filter: {
        query: params.query ?? '*',
        from: params.from ?? 'now-1h',
        to: params.to ?? 'now',
      },
      page: {
        limit: params.limit ?? 25,
      },
      sort: params.sort ?? '-timestamp',
    };

    const data = await apiPost<Record<string, unknown>>('/api/v2/security_monitoring/signals/search', body);
    return { signals: data.data ?? [], meta: data.meta ?? null };
  },
});
