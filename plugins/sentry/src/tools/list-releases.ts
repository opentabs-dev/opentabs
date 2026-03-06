import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getOrgSlug, sentryApi } from '../sentry-api.js';
import { mapRelease, releaseSchema } from './schemas.js';

export const listReleases = defineTool({
  name: 'list_releases',
  displayName: 'List Releases',
  description:
    'List releases for the current Sentry organization. Optionally filter by project ID(s). ' +
    'Returns version, release date, new issue count, commit count, and deploy count.',
  summary: 'List releases with optional project filter',
  icon: 'tag',
  group: 'Releases',
  input: z.object({
    project: z
      .array(z.number().describe('Project ID'))
      .optional()
      .describe('Filter by project IDs (use list_projects to find IDs). Omit to list all releases'),
    query: z.string().optional().describe('Filter releases by version string (partial match)'),
    limit: z.number().optional().describe('Maximum number of releases to return (default 25, max 100)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    releases: z.array(releaseSchema).describe('List of releases'),
  }),
  handle: async params => {
    const orgSlug = getOrgSlug();
    const data = await sentryApi<Record<string, unknown>[]>(`/organizations/${orgSlug}/releases/`, {
      query: {
        project: params.project,
        query: params.query,
        per_page: params.limit,
        cursor: params.cursor,
      },
    });
    return {
      releases: (Array.isArray(data) ? data : []).map(r => mapRelease(r)),
    };
  },
});
