import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawWorkspace, workspaceSchema, mapWorkspace } from './schemas.js';

export const listWorkspaces = defineTool({
  name: 'list_workspaces',
  displayName: 'List Workspaces',
  description: 'List all Bitbucket workspaces the authenticated user has access to. Supports pagination.',
  summary: 'List workspaces',
  icon: 'building',
  group: 'Workspaces',
  input: z.object({
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
  }),
  output: z.object({
    workspaces: z.array(workspaceSchema).describe('Array of workspaces'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
    };
    const data = await api<{ values: RawWorkspace[] }>('/workspaces', { query });
    return { workspaces: (data.values ?? []).map(mapWorkspace) };
  },
});
