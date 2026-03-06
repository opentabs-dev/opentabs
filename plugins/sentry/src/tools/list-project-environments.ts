import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getOrgSlug, sentryApi } from '../sentry-api.js';

const environmentSchema = z.object({
  id: z.string().describe('Environment ID'),
  name: z.string().describe('Environment name (e.g., production, staging)'),
  is_hidden: z.boolean().describe('Whether the environment is hidden from the UI'),
});

type Environment = z.infer<typeof environmentSchema>;

const mapEnvironment = (e: Record<string, unknown> | undefined): Environment => ({
  id: (e?.id as string) ?? '',
  name: (e?.name as string) ?? '',
  is_hidden: (e?.isHidden as boolean) ?? false,
});

export const listProjectEnvironments = defineTool({
  name: 'list_project_environments',
  displayName: 'List Project Environments',
  description:
    'List environments for a Sentry project. Returns environment names and visibility status. ' +
    'Use the project slug from list_projects.',
  summary: 'List project environments',
  icon: 'server',
  group: 'Projects',
  input: z.object({
    project_slug: z.string().describe('Project slug to list environments for'),
  }),
  output: z.object({
    environments: z.array(environmentSchema).describe('List of environments'),
  }),
  handle: async params => {
    const orgSlug = getOrgSlug();
    const data = await sentryApi<Record<string, unknown>[]>(
      `/projects/${orgSlug}/${encodeURIComponent(params.project_slug)}/environments/`,
    );
    return {
      environments: (Array.isArray(data) ? data : []).map(e => mapEnvironment(e)),
    };
  },
});
