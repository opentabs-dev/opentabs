import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawPlaygroundQuery, mapPlaygroundQuery, playgroundQuerySchema } from './schemas.js';

export const listPlaygroundQueries = defineTool({
  name: 'list_playground_queries',
  displayName: 'List Playground Queries',
  description:
    'List all saved playground queries for the current user and the organization. The playground allows running ad-hoc queries against connected resources.',
  summary: 'List saved playground queries',
  icon: 'terminal',
  group: 'Queries',
  input: z.object({}),
  output: z.object({
    user_queries: z.array(playgroundQuerySchema).describe('Personal saved queries'),
    org_queries: z.array(playgroundQuerySchema).describe('Organization-wide saved queries'),
  }),
  handle: async () => {
    const data = await api<{
      userQueries: RawPlaygroundQuery[];
      orgQueries: RawPlaygroundQuery[];
    }>('/api/playground');
    return {
      user_queries: (data.userQueries ?? []).map(mapPlaygroundQuery),
      org_queries: (data.orgQueries ?? []).map(mapPlaygroundQuery),
    };
  },
});
