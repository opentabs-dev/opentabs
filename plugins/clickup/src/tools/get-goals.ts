import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getWorkspaceId } from '../clickup-api.js';
import { goalSchema, mapGoal } from './schemas.js';

export const getGoals = defineTool({
  name: 'get_goals',
  displayName: 'Get Goals',
  description:
    'List all goals in a ClickUp workspace. Goals track high-level objectives and can contain key results. Returns goal name, description, completion percentage, and owner.',
  summary: 'List workspace goals',
  icon: 'target',
  group: 'Goals',
  input: z.object({
    workspace_id: z.string().optional().describe('Workspace ID. Defaults to the current workspace.'),
  }),
  output: z.object({
    goals: z.array(goalSchema).describe('List of goals'),
  }),
  handle: async params => {
    const wsId = params.workspace_id ?? getWorkspaceId();
    const data = await api<{ goals: Record<string, unknown>[] }>(`/v1/team/${wsId}/goal`);
    return { goals: (data.goals ?? []).map(mapGoal) };
  },
});
