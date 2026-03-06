import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getOrgSlug, sentryApi } from '../sentry-api.js';

const replaySchema = z.object({
  id: z.string().describe('Replay ID'),
  title: z.string().describe('Page title during the replay'),
  duration: z.number().describe('Replay duration in seconds'),
  count_errors: z.number().describe('Number of errors during the replay'),
  started_at: z.string().describe('ISO 8601 timestamp when the replay started'),
  finished_at: z.string().describe('ISO 8601 timestamp when the replay ended'),
  urls: z.array(z.string()).describe('URLs visited during the replay'),
  project_id: z.string().describe('Project ID the replay belongs to'),
});

export const listReplays = defineTool({
  name: 'list_replays',
  displayName: 'List Replays',
  description:
    'List session replays for the current Sentry organization. Replays capture user browser sessions ' +
    'including DOM interactions, console logs, and network requests.',
  summary: 'List session replays in the organization',
  icon: 'video',
  group: 'Replays',
  input: z.object({
    project: z
      .array(z.number().describe('Project ID'))
      .optional()
      .describe('Filter by project IDs. Omit to list replays across all projects'),
    query: z.string().optional().describe('Search query to filter replays (e.g., by URL or error)'),
    limit: z.number().optional().describe('Maximum number of replays to return (default 25, max 100)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    replays: z.array(replaySchema).describe('List of session replays'),
  }),
  handle: async params => {
    const orgSlug = getOrgSlug();
    const resp = await sentryApi<Record<string, unknown>>(`/organizations/${orgSlug}/replays/`, {
      query: {
        project: params.project,
        query: params.query,
        per_page: params.limit,
        cursor: params.cursor,
      },
    });
    const data = (resp.data as Array<Record<string, unknown>>) ?? [];
    return {
      replays: data.map(r => ({
        id: (r.id as string) ?? '',
        title: (r.title as string) ?? '',
        duration: (r.duration as number) ?? 0,
        count_errors: (r.count_errors as number) ?? (r.countErrors as number) ?? 0,
        started_at: (r.started_at as string) ?? (r.startedAt as string) ?? '',
        finished_at: (r.finished_at as string) ?? (r.finishedAt as string) ?? '',
        urls: ((r.urls as string[]) ?? []).slice(0, 10),
        project_id: (r.project_id as string) ?? String(r.projectId ?? ''),
      })),
    };
  },
});
