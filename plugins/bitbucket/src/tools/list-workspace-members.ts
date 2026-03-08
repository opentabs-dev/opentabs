import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawMember, memberSchema, mapMember } from './schemas.js';

export const listWorkspaceMembers = defineTool({
  name: 'list_workspace_members',
  displayName: 'List Workspace Members',
  description: 'List all members of a Bitbucket workspace. Supports pagination.',
  summary: 'List workspace members',
  icon: 'users',
  group: 'Workspaces',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
  }),
  output: z.object({
    members: z.array(memberSchema).describe('Array of workspace members'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
    };
    const data = await api<{ values: RawMember[] }>(`/workspaces/${params.workspace}/members`, { query });
    return { members: (data.values ?? []).map(mapMember) };
  },
});
