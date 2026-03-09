import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../clickup-api.js';
import { folderSchema, mapFolder } from './schemas.js';

export const getFolders = defineTool({
  name: 'get_folders',
  displayName: 'Get Folders',
  description:
    'List all folders in a ClickUp space. Folders organize lists within a space. By default excludes archived folders.',
  summary: 'List folders in a space',
  icon: 'folder',
  group: 'Folders',
  input: z.object({
    space_id: z.string().min(1).describe('Space ID to list folders for'),
    include_archived: z.boolean().optional().describe('Whether to include archived folders (default: false)'),
  }),
  output: z.object({
    folders: z.array(folderSchema).describe('List of folders'),
  }),
  handle: async params => {
    const data = await api<{ categories: Record<string, unknown>[] }>(
      `/hierarchy/v1/project/${params.space_id}/category`,
      {
        query: { include_archived: params.include_archived ?? false },
      },
    );
    return { folders: (data.categories ?? []).map(mapFolder) };
  },
});
