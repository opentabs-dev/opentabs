import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawRepo, repositorySchema, mapRepository } from './schemas.js';

export const createRepository = defineTool({
  name: 'create_repository',
  displayName: 'Create Repository',
  description: 'Create a new repository in a Bitbucket workspace.',
  summary: 'Create a new repository',
  icon: 'plus',
  group: 'Repositories',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug (URL-friendly name)'),
    scm: z.string().optional().describe('Source control type (default "git")'),
    is_private: z.boolean().optional().describe('Whether the repository is private (default true)'),
    description: z.string().optional().describe('Repository description'),
    has_issues: z.boolean().optional().describe('Whether to enable the issue tracker'),
    has_wiki: z.boolean().optional().describe('Whether to enable the wiki'),
  }),
  output: repositorySchema,
  handle: async params => {
    const body: Record<string, unknown> = {
      scm: params.scm ?? 'git',
      is_private: params.is_private ?? true,
    };
    if (params.description !== undefined) body.description = params.description;
    if (params.has_issues !== undefined) body.has_issues = params.has_issues;
    if (params.has_wiki !== undefined) body.has_wiki = params.has_wiki;

    const data = await api<RawRepo>(`/repositories/${params.workspace}/${params.repo_slug}`, {
      method: 'POST',
      body,
    });
    return mapRepository(data);
  },
});
