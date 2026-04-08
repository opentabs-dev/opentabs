import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { monitorSchema, mapMonitor } from './schemas.js';

export const listMonitors = defineTool({
  name: 'list_monitors',
  displayName: 'List Monitors',
  description:
    'List monitors in the Datadog organization. Supports filtering by tags and pagination. Returns monitor details including name, type, query, state, and tags.',
  summary: 'List Datadog monitors with optional tag filters',
  icon: 'monitor',
  group: 'Monitors',
  input: z.object({
    tags: z.string().optional().describe('Comma-separated tags to filter monitors (e.g., "env:prod,team:backend")'),
    page: z.number().int().min(0).optional().describe('Page number for pagination (default 0)'),
    per_page: z.number().int().min(1).max(100).optional().describe('Monitors per page (default 50, max 100)'),
  }),
  output: z.object({
    monitors: z.array(monitorSchema),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      page: params.page ?? 0,
      per_page: params.per_page ?? 50,
    };
    if (params.tags) query.tags = params.tags;

    const data = await apiGet<Array<Record<string, unknown>>>('/api/v1/monitor', query);
    return { monitors: (data ?? []).map(mapMonitor) };
  },
});
