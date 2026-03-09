import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../clickup-api.js';
import { listSchema, mapList } from './schemas.js';

export const getLists = defineTool({
  name: 'get_lists',
  displayName: 'Get Lists',
  description:
    'List all lists in a ClickUp folder. Lists contain tasks and are the primary work containers. By default excludes archived lists.',
  summary: 'List lists in a folder',
  icon: 'list',
  group: 'Lists',
  input: z.object({
    folder_id: z.string().min(1).describe('Folder ID to list lists for'),
    include_archived: z.boolean().optional().describe('Whether to include archived lists (default: false)'),
  }),
  output: z.object({
    lists: z.array(listSchema).describe('List of lists'),
  }),
  handle: async params => {
    const data = await api<{ subcategories: Record<string, unknown>[] }>(
      `/hierarchy/v1/category/${params.folder_id}/subcategory`,
      {
        query: { include_archived: params.include_archived ?? false },
      },
    );
    return { lists: (data.subcategories ?? []).map(mapList) };
  },
});
