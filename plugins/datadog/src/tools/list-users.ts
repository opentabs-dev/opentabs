import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { userSchema, mapUser } from './schemas.js';

export const listUsers = defineTool({
  name: 'list_users',
  displayName: 'List Users',
  description: 'List users in the Datadog organization. Supports filtering and pagination.',
  summary: 'List organization users',
  icon: 'users',
  group: 'Users',
  input: z.object({
    filter: z.string().optional().describe('Filter users by name or email'),
    page_size: z.number().int().min(1).max(100).optional().describe('Results per page (default 25)'),
    page_number: z.number().int().min(0).optional().describe('Page number (default 0)'),
  }),
  output: z.object({
    users: z.array(userSchema),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      'page[size]': params.page_size ?? 25,
      'page[number]': params.page_number ?? 0,
    };
    if (params.filter) query.filter = params.filter;

    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v2/users', query);
    return { users: (data.data ?? []).map(mapUser) };
  },
});
