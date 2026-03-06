import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

const releaseSchema = z.object({
  id: z.number().describe('Release ID'),
  tag_name: z.string().describe('Git tag name'),
  name: z.string().describe('Release title'),
  body: z.string().describe('Release notes in Markdown'),
  draft: z.boolean().describe('Whether this is a draft release'),
  prerelease: z.boolean().describe('Whether this is a prerelease'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  published_at: z.string().describe('Published ISO 8601 timestamp'),
  html_url: z.string().describe('URL to the release on GitHub'),
  author_login: z.string().describe('Login of the release author'),
});

interface RawRelease {
  id?: number;
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  created_at?: string;
  published_at?: string | null;
  html_url?: string;
  author?: { login?: string };
}

const mapRelease = (r: RawRelease) => ({
  id: r.id ?? 0,
  tag_name: r.tag_name ?? '',
  name: r.name ?? '',
  body: r.body ?? '',
  draft: r.draft ?? false,
  prerelease: r.prerelease ?? false,
  created_at: r.created_at ?? '',
  published_at: r.published_at ?? '',
  html_url: r.html_url ?? '',
  author_login: r.author?.login ?? '',
});

export const listReleases = defineTool({
  name: 'list_releases',
  displayName: 'List Releases',
  description: 'List releases for a repository. Returns published and draft releases sorted by creation date.',
  summary: 'List releases for a repository',
  icon: 'package',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
    page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  }),
  output: z.object({
    releases: z.array(releaseSchema).describe('List of releases'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      per_page: params.per_page ?? 30,
      page: params.page,
    };

    const data = await api<RawRelease[]>(`/repos/${params.owner}/${params.repo}/releases`, { query });
    return { releases: (data ?? []).map(mapRelease) };
  },
});
