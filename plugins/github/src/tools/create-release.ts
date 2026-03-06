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

export const createRelease = defineTool({
  name: 'create_release',
  displayName: 'Create Release',
  description: 'Create a new release for a repository. Optionally create as a draft or prerelease.',
  summary: 'Create a release in a repository',
  icon: 'package',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    tag_name: z.string().min(1).describe('Git tag name for the release'),
    name: z.string().optional().describe('Release title'),
    body: z.string().optional().describe('Release notes in Markdown'),
    draft: z.boolean().optional().describe('Create as a draft release (default: false)'),
    prerelease: z.boolean().optional().describe('Mark as a prerelease (default: false)'),
    target_commitish: z.string().optional().describe('Branch or commit SHA to tag — defaults to the default branch'),
  }),
  output: z.object({
    release: releaseSchema.describe('The created release'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      tag_name: params.tag_name,
    };
    if (params.name !== undefined) body.name = params.name;
    if (params.body !== undefined) body.body = params.body;
    if (params.draft !== undefined) body.draft = params.draft;
    if (params.prerelease !== undefined) body.prerelease = params.prerelease;
    if (params.target_commitish !== undefined) body.target_commitish = params.target_commitish;

    const data = await api<RawRelease>(`/repos/${params.owner}/${params.repo}/releases`, {
      method: 'POST',
      body,
    });
    return {
      release: {
        id: data.id ?? 0,
        tag_name: data.tag_name ?? '',
        name: data.name ?? '',
        body: data.body ?? '',
        draft: data.draft ?? false,
        prerelease: data.prerelease ?? false,
        created_at: data.created_at ?? '',
        published_at: data.published_at ?? '',
        html_url: data.html_url ?? '',
        author_login: data.author?.login ?? '',
      },
    };
  },
});
