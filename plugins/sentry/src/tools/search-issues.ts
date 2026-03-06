import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getOrgSlug, sentryApi } from '../sentry-api.js';
import { issueSchema, mapIssue } from './schemas.js';

export const searchIssues = defineTool({
  name: 'search_issues',
  displayName: 'Search Issues',
  description:
    'Search and list issues for a Sentry organization. Supports Sentry search syntax in the query parameter ' +
    '(e.g., "is:unresolved", "assigned:me", "level:error", "first-seen:-24h"). ' +
    'Filter by project IDs, environment, and time range. Results are paginated with a cursor.',
  summary: 'Search and list issues with optional filters',
  icon: 'search',
  group: 'Issues',
  input: z.object({
    query: z
      .string()
      .optional()
      .describe(
        'Search query using Sentry search syntax (e.g., "is:unresolved", "assigned:me", "level:error"). Defaults to "is:unresolved"',
      ),
    project: z
      .array(z.number().describe('Project ID'))
      .optional()
      .describe('Array of project IDs to filter by. Omit to search all projects'),
    environment: z
      .array(z.string().describe('Environment name'))
      .optional()
      .describe('Environment names to filter by (e.g., ["production", "staging"])'),
    sort: z
      .enum(['date', 'new', 'freq', 'user', 'trends'])
      .optional()
      .describe('Sort order: "date" (last seen), "new" (first seen), "freq" (events), "user" (users), "trends"'),
    limit: z.number().optional().describe('Maximum number of issues to return (default 25, max 100)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    issues: z.array(issueSchema).describe('List of matching issues'),
  }),
  handle: async params => {
    const orgSlug = getOrgSlug();
    const data = await sentryApi<Record<string, unknown>[]>(`/organizations/${orgSlug}/issues/`, {
      query: {
        query: params.query ?? 'is:unresolved',
        sort: params.sort,
        limit: params.limit ?? 25,
        cursor: params.cursor,
        project: params.project,
        environment: params.environment,
      },
    });
    return {
      issues: (Array.isArray(data) ? data : []).map(i => mapIssue(i)),
    };
  },
});
