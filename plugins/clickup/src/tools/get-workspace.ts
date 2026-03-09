import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getWorkspaceId } from '../clickup-api.js';
import { workspaceSchema, mapWorkspace } from './schemas.js';

export const getWorkspace = defineTool({
  name: 'get_workspace',
  displayName: 'Get Workspace',
  description:
    'Get detailed information about a ClickUp workspace including name, owner, plan, and member count. If no workspace_id is provided, returns the current workspace.',
  summary: 'Get workspace details',
  icon: 'building-2',
  group: 'Workspaces',
  input: z.object({
    workspace_id: z.string().optional().describe('Workspace ID. Defaults to the current workspace.'),
  }),
  output: z.object({ workspace: workspaceSchema.describe('Workspace details') }),
  handle: async params => {
    const wsId = params.workspace_id ?? getWorkspaceId();
    const data = await api<Record<string, unknown>>(`/team/v1/team/${wsId}`);
    return { workspace: mapWorkspace(data) };
  },
});
