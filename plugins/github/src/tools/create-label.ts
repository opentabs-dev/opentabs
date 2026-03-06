import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';

const labelSchema = z.object({
  id: z.number().describe('Label ID'),
  name: z.string().describe('Label name'),
  color: z.string().describe('Label hex color (without #)'),
  description: z.string().describe('Label description'),
});

interface RawLabel {
  id?: number;
  name?: string;
  color?: string;
  description?: string | null;
}

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
    const body: Record<string, unknown> = {
      name: params.name,
    };
    if (params.color !== undefined) body.color = params.color;
    if (params.description !== undefined) body.description = params.description;

    const data = await api<RawLabel>(`/repos/${params.owner}/${params.repo}/labels`, {
      method: 'POST',
      body,
    });
    return {
      label: {
        id: data.id ?? 0,
        name: data.name ?? '',
        color: data.color ?? '',
        description: data.description ?? '',
      },
    };
  },
});
