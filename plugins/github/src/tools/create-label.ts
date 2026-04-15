import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getMutationId, graphql, turboData } from '../github-api.js';
import { labelSchema } from './schemas.js';

export const createLabel = defineTool({
  name: 'create_label',
  displayName: 'Create Label',
  description: 'Create a new label in a repository.',
  summary: 'Create a label in a repository',
  icon: 'tag',
  group: 'Issues',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    name: z.string().min(1).describe('Label name'),
    color: z.string().optional().describe('Label hex color without the # prefix (e.g., "ff0000")'),
    description: z.string().optional().describe('Label description'),
  }),
  output: z.object({
    label: labelSchema.describe('The created label'),
  }),
  handle: async params => {
    // Get repository node ID
    const { data: repoData } = await turboData<{ repository?: { id?: string } }>(
      `/${params.owner}/${params.repo}/issues`,
      { q: 'is:issue is:open' },
    );
    const repoId = repoData?.repository?.id;
    if (!repoId) throw ToolError.internal('Could not determine repository ID');

    const mutationId = await getMutationId('createRepositoryLabelMutation');
    await graphql(mutationId, {
      repositoryId: repoId,
      name: params.name,
      color: params.color ?? 'ededed',
      description: params.description ?? '',
    });

    return {
      label: {
        id: 0,
        name: params.name,
        color: params.color ?? 'ededed',
        description: params.description ?? '',
      },
    };
  },
});
