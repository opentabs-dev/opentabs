import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { vercelApi } from '../vercel-api.js';

export const listTeams = defineTool({
  name: 'list_teams',
  displayName: 'List Teams',
  description: 'List all teams the current user belongs to. Returns team names, slugs, billing plans, and roles.',
  summary: 'List Vercel teams',
  icon: 'users',
  group: 'Account',
  input: z.object({
    limit: z.number().optional().describe('Maximum number of teams to return (default 20)'),
    since: z.string().optional().describe('Pagination cursor — timestamp to start from'),
  }),
  output: z.object({
    teams: z
      .array(
        z.object({
          id: z.string().describe('Team ID'),
          slug: z.string().describe('Team slug'),
          name: z.string().describe('Team name'),
          billing_plan: z.string().describe('Billing plan (hobby, pro, enterprise)'),
          role: z.string().describe('Current user role in this team (OWNER, MEMBER, etc.)'),
          created_at: z.string().describe('ISO 8601 creation timestamp'),
        }),
      )
      .describe('List of teams'),
  }),
  handle: async params => {
    const data = await vercelApi<Record<string, unknown>>('/v2/teams', {
      query: { limit: params.limit ?? 20, since: params.since },
    });
    const teams = Array.isArray(data.teams) ? (data.teams as Record<string, unknown>[]) : [];
    return {
      teams: teams.map(t => {
        const billing = t.billing as Record<string, unknown> | undefined;
        const membership = t.membership as Record<string, unknown> | undefined;
        return {
          id: (t.id as string) ?? '',
          slug: (t.slug as string) ?? '',
          name: (t.name as string) ?? '',
          billing_plan: (billing?.plan as string) ?? 'hobby',
          role: (membership?.role as string) ?? '',
          created_at: t.createdAt ? new Date(t.createdAt as number).toISOString() : ((t.created as string) ?? ''),
        };
      }),
    };
  },
});
