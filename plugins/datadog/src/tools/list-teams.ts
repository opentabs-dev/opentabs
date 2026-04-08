import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

const teamSchema = z.object({
  id: z.string().describe('Team ID'),
  name: z.string().describe('Team name'),
  handle: z.string().describe('Team handle (used for @mentions)'),
  description: z.string().describe('Team description'),
  member_count: z.number().describe('Number of members'),
});

export const listTeams = defineTool({
  name: 'list_teams',
  displayName: 'List Teams',
  description: 'List teams in the Datadog organization.',
  summary: 'List teams',
  icon: 'users',
  group: 'Teams',
  input: z.object({
    page_size: z.number().int().min(1).max(100).optional().describe('Results per page'),
    page_number: z.number().int().min(0).optional().describe('Page number'),
    filter: z.string().optional().describe('Filter by team name'),
  }),
  output: z.object({ teams: z.array(teamSchema) }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      'page[size]': params.page_size ?? 25,
      'page[number]': params.page_number ?? 0,
    };
    if (params.filter) query['filter[keyword]'] = params.filter;
    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v2/team', query);
    return {
      teams: (data.data ?? []).map(t => {
        const attrs = (t.attributes as Record<string, unknown>) ?? {};
        return {
          id: (t.id as string) ?? '',
          name: (attrs.name as string) ?? '',
          handle: (attrs.handle as string) ?? '',
          description: (attrs.description as string) ?? '',
          member_count: (attrs.member_count as number) ?? 0,
        };
      }),
    };
  },
});
