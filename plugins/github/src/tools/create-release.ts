import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';
import { releaseSchema } from './schemas.js';

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
    const fields: Record<string, string> = {
      'release[tag_name]': params.tag_name,
    };
    if (params.name) fields['release[name]'] = params.name;
    if (params.body) fields['release[body]'] = params.body;
    if (params.draft) fields['release[draft]'] = '1';
    if (params.prerelease) fields['release[prerelease]'] = '1';
    if (params.target_commitish) fields['release[target_commitish]'] = params.target_commitish;

    await submitPageForm(`/${params.owner}/${params.repo}/releases/new`, 'form[action*="releases"]', fields);

    return {
      release: {
        id: 0,
        tag_name: params.tag_name,
        name: params.name ?? params.tag_name,
        body: params.body ?? '',
        draft: params.draft ?? false,
        prerelease: params.prerelease ?? false,
        created_at: new Date().toISOString(),
        published_at: params.draft ? '' : new Date().toISOString(),
        html_url: `https://github.com/${params.owner}/${params.repo}/releases/tag/${params.tag_name}`,
        author_login: '',
      },
    };
  },
});
