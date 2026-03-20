import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawResourceFolder, mapResourceFolder, resourceFolderSchema } from './schemas.js';

export const createResourceFolder = defineTool({
  name: 'create_resource_folder',
  displayName: 'Create Resource Folder',
  description: 'Create a new folder for organizing resources (data sources). Requires a parent resource folder ID.',
  summary: 'Create a new resource folder',
  icon: 'folder-plus',
  group: 'Resources',
  input: z.object({
    name: z.string().describe('Name for the new resource folder'),
    parent_resource_folder_id: z.number().describe('Parent resource folder ID'),
  }),
  output: z.object({ folder: resourceFolderSchema }),
  handle: async params => {
    const data = await api<RawResourceFolder>('/api/resourceFolders/createResourceFolder', {
      method: 'POST',
      body: {
        resourceFolderName: params.name,
        parentResourceFolderId: params.parent_resource_folder_id,
      },
    });
    return { folder: mapResourceFolder(data ?? {}) };
  },
});
