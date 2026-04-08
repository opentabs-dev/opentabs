import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { monitorSearchResultSchema, mapMonitorSearchResult } from './schemas.js';

export const searchMonitors = defineTool({
  name: 'search_monitors',
  displayName: 'Search Monitors',
  description:
    'Search for monitors by query string. Supports searching by name, status, tags, and other attributes. Use Datadog monitor search syntax (e.g., "status:Alert", "tag:env:prod", "type:metric").',
  summary: 'Search monitors by name, status, tags, or type',
  icon: 'search',
  group: 'Monitors',
  input: z.object({
    query: z.string().describe('Monitor search query (e.g., "status:Alert", "tag:env:prod", "my-service")'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 25)'),
    page: z.number().int().min(0).optional().describe('Page number (default 0)'),
  }),
  output: z.object({
    monitors: z.array(monitorSearchResultSchema),
    total_count: z.number().describe('Total number of matching monitors'),
  }),
  handle: async params => {
    const data = await apiGet<{
      monitors?: Array<Record<string, unknown>>;
      metadata?: { total_count?: number };
    }>('/api/v1/monitor/search', {
      query: params.query,
      per_page: params.per_page ?? 25,
      page: params.page ?? 0,
    });
    return {
      monitors: (data.monitors ?? []).map(mapMonitorSearchResult),
      total_count: data.metadata?.total_count ?? 0,
    };
  },
});
