import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getOrgSlug, sentryApi } from '../sentry-api.js';

const releaseAuthorSchema = z.object({
  name: z.string().describe('Author name'),
  email: z.string().describe('Author email address'),
});

const releaseDetailSchema = z.object({
  version: z.string().describe('Release version identifier'),
  short_version: z.string().describe('Short version for display'),
  date_released: z.string().nullable().describe('ISO 8601 timestamp when the release was deployed'),
  date_created: z.string().describe('ISO 8601 timestamp when the release was created'),
  first_event: z.string().nullable().describe('ISO 8601 timestamp of the first event in this release'),
  last_event: z.string().nullable().describe('ISO 8601 timestamp of the last event in this release'),
  new_groups: z.number().describe('Number of new issues in this release'),
  commit_count: z.number().describe('Number of commits in this release'),
  deploy_count: z.number().describe('Number of deployments for this release'),
  authors: z.array(releaseAuthorSchema).describe('Authors who contributed to this release'),
  url: z.string().describe('URL to the release in Sentry'),
});

type ReleaseDetail = z.infer<typeof releaseDetailSchema>;

const mapReleaseDetail = (r: Record<string, unknown> | undefined): ReleaseDetail => {
  const rawAuthors = (r?.authors as Array<Record<string, unknown>>) ?? [];
  const orgSlug = getOrgSlug();
  const version = (r?.version as string) ?? '';
  return {
    version,
    short_version: (r?.shortVersion as string) ?? '',
    date_released: (r?.dateReleased as string) ?? null,
    date_created: (r?.dateCreated as string) ?? '',
    first_event: (r?.firstEvent as string) ?? null,
    last_event: (r?.lastEvent as string) ?? null,
    new_groups: (r?.newGroups as number) ?? 0,
    commit_count: (r?.commitCount as number) ?? 0,
    deploy_count: (r?.deployCount as number) ?? 0,
    authors: rawAuthors.map(a => ({
      name: (a.name as string) ?? '',
      email: (a.email as string) ?? '',
    })),
    url: version ? `https://${orgSlug}.sentry.io/releases/${encodeURIComponent(version)}/` : '',
  };
};

export const getRelease = defineTool({
  name: 'get_release',
  displayName: 'Get Release',
  description:
    'Get detailed information about a specific release, including commit count, deploy count, ' +
    'authors, and first/last event timestamps.',
  summary: 'Get release details by version',
  icon: 'package',
  group: 'Releases',
  input: z.object({
    version: z.string().describe('The release version string (e.g., "1.0.0" or a commit SHA)'),
  }),
  output: releaseDetailSchema,
  handle: async params => {
    const orgSlug = getOrgSlug();
    const data = await sentryApi<Record<string, unknown>>(
      `/organizations/${orgSlug}/releases/${encodeURIComponent(params.version)}/`,
    );
    return mapReleaseDetail(data);
  },
});
