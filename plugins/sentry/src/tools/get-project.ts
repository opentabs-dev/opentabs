import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getOrgSlug, sentryApi } from '../sentry-api.js';
import { mapProject, projectSchema } from './schemas.js';

export const getProject = defineTool({
  name: 'get_project',
  displayName: 'Get Project',
  description:
    'Get detailed information about a specific Sentry project by its slug. ' +
    'Returns platform, status, date created, and access information.',
  summary: 'Get details for a specific project',
  icon: 'folder-open',
  group: 'Projects',
  input: z.object({
    project_slug: z.string().describe('The project slug to retrieve'),
  }),
  output: z.object({
    project: projectSchema.describe('The project details'),
  }),
  handle: async params => {
    const orgSlug = getOrgSlug();
    const { data } = await sentryApi<Record<string, unknown>>(
      `/projects/${orgSlug}/${encodeURIComponent(params.project_slug)}/`,
    );
    return { project: mapProject(data) };
  },
});
