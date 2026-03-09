import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../clickup-api.js';
import { folderSchema, mapFolder } from './schemas.js';

export const getFolder = defineTool({
  name: 'get_folder',
  displayName: 'Get Folder',
  description:
    'Get detailed information about a specific ClickUp folder by its ID. Returns folder name, order, archive status, and parent space.',
  summary: 'Get folder details by ID',
  icon: 'folder-open',
  group: 'Folders',
  input: z.object({
    folder_id: z.string().min(1).describe('Folder ID'),
  }),
  output: z.object({ folder: folderSchema.describe('Folder details') }),
  handle: async params => {
    const data = await api<Record<string, unknown>>(`/hierarchy/v1/category/${params.folder_id}`);
    return { folder: mapFolder(data) };
  },
});
