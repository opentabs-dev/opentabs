import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getWorkspaceId } from '../clickup-api.js';
import { memberSchema, mapMember } from './schemas.js';

export const getWorkspaceMembers = defineTool({
  name: 'get_workspace_members',
  displayName: 'Get Workspace Members',
  description:
    'List all members in a ClickUp workspace including their name, email, role, and avatar. If no workspace_id is provided, uses the current workspace.',
  summary: 'List workspace members',
  icon: 'users',
  group: 'Workspaces',
  input: z.object({
    workspace_id: z.string().optional().describe('Workspace ID. Defaults to the current workspace.'),
  }),
  output: z.object({
    members: z.array(memberSchema).describe('List of workspace members'),
  }),
  handle: async params => {
    const wsId = params.workspace_id ?? getWorkspaceId();
    const data = await api<{ members: Record<string, unknown>[] }>(`/v1/team/${wsId}/member`);
    return { members: (data.members ?? []).map(mapMember) };
  },
});
