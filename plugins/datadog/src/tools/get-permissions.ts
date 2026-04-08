import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const getPermissions = defineTool({
  name: 'get_permissions',
  displayName: 'Get Permissions',
  description:
    'List all available permissions in the Datadog organization. Useful for understanding role-based access.',
  summary: 'List available permissions',
  icon: 'shield',
  group: 'Admin',
  input: z.object({}),
  output: z.object({
    permissions: z.array(
      z.object({
        id: z.string().describe('Permission ID'),
        name: z.string().describe('Permission name'),
        description: z.string().describe('Permission description'),
        group_name: z.string().describe('Permission group'),
      }),
    ),
  }),
  handle: async () => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v2/permissions');
    return {
      permissions: (data.data ?? []).map(p => {
        const attrs = (p.attributes as Record<string, unknown>) ?? {};
        return {
          id: (p.id as string) ?? '',
          name: (attrs.name as string) ?? '',
          description: (attrs.description as string) ?? '',
          group_name: (attrs.group_name as string) ?? '',
        };
      }),
    };
  },
});
