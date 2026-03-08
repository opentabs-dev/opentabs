import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawTag, tagSchema, mapTag } from './schemas.js';

export const listTags = defineTool({
  name: 'list_tags',
  displayName: 'List Tags',
  description: 'List tags in a Bitbucket repository. Supports pagination.',
  summary: 'List repository tags',
  icon: 'tag',
  group: 'Branches & Tags',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
  }),
  output: z.object({
    tags: z.array(tagSchema).describe('Array of tags'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
    };
    const data = await api<{ values: RawTag[] }>(`/repositories/${params.workspace}/${params.repo_slug}/refs/tags`, {
      query,
    });
    return { tags: (data.values ?? []).map(mapTag) };
  },
});
