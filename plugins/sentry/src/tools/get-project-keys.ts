import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getOrgSlug, sentryApi } from '../sentry-api.js';

const projectKeySchema = z.object({
  id: z.string().describe('Key ID'),
  name: z.string().describe('Key label/name'),
  dsn_public: z.string().describe('Public DSN for client-side SDK initialization'),
  dsn_secret: z.string().describe('Secret DSN (deprecated, use public DSN instead)'),
  date_created: z.string().describe('ISO 8601 timestamp when the key was created'),
  is_active: z.boolean().describe('Whether the key is currently active'),
});

export const getProjectKeys = defineTool({
  name: 'get_project_keys',
  displayName: 'Get Project Keys',
  description:
    'List client keys (DSNs) for a Sentry project. The DSN is needed to initialize the Sentry SDK ' +
    'in your application. Returns the public DSN, key name, and active status.',
  summary: 'List DSN keys for a project',
  icon: 'key',
  group: 'Projects',
  input: z.object({
    project_slug: z.string().describe('Project slug to retrieve keys for'),
  }),
  output: z.object({
    keys: z.array(projectKeySchema).describe('List of client keys (DSNs) for the project'),
  }),
  handle: async params => {
    const orgSlug = getOrgSlug();
    const { data } = await sentryApi<Record<string, unknown>[]>(
      `/projects/${orgSlug}/${encodeURIComponent(params.project_slug)}/keys/`,
    );
    return {
      keys: (Array.isArray(data) ? data : []).map(k => {
        const dsn = (k.dsn as Record<string, unknown>) ?? {};
        return {
          id: (k.id as string) ?? '',
          name: (k.name as string) ?? (k.label as string) ?? '',
          dsn_public: (dsn.public as string) ?? '',
          dsn_secret: (dsn.secret as string) ?? '',
          date_created: (k.dateCreated as string) ?? '',
          is_active: (k.isActive as boolean) ?? true,
        };
      }),
    };
  },
});
