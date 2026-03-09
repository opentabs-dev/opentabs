import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getWorkspaceId } from '../clickup-api.js';
import { spaceSchema, mapSpace } from './schemas.js';

export const getSpaces = defineTool({
  name: 'get_spaces',
  displayName: 'Get Spaces',
  description:
    'List all spaces in a ClickUp workspace. Spaces are top-level containers for organizing work. Returns space name, color, privacy, and archive status. By default excludes archived spaces.',
  summary: 'List spaces in a workspace',
  icon: 'layers',
  group: 'Spaces',
  input: z.object({
    workspace_id: z.string().optional().describe('Workspace ID. Defaults to the current workspace.'),
    include_archived: z.boolean().optional().describe('Whether to include archived spaces (default: false)'),
  }),
  output: z.object({
    spaces: z.array(spaceSchema).describe('List of spaces'),
  }),
  handle: async params => {
    const wsId = params.workspace_id ?? getWorkspaceId();
    const data = await api<Record<string, unknown>[]>('/hierarchy/v1/project', {
      query: {
        team: wsId,
        include_archived: params.include_archived ?? false,
      },
    });
    return { spaces: (data ?? []).map(mapSpace) };
  },
});
