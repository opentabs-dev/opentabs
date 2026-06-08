import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { folderSchema, mapFolder, type RawFolder } from './schemas.js';

export const createFolder = defineTool({
  name: 'create_folder',
  displayName: 'Create Folder',
  description: 'Create a new folder for organizing apps or workflows. Specify the parent folder ID and folder type.',
  summary: 'Create a new app or workflow folder',
  icon: 'folder-plus',
  group: 'Apps',
  input: z.object({
    name: z.string().describe('Name for the new folder'),
    parent_folder_id: z.number().describe('Parent folder ID (use list_apps to find folder IDs)'),
    folder_type: z.enum(['app', 'workflow']).optional().describe('Folder type (default "app")'),
  }),
  output: z.object({ folder: folderSchema }),
  handle: async params => {
    const data = await api<{ folder: RawFolder }>('/api/folders/createFolder', {
      method: 'POST',
      body: {
        folderName: params.name,
        parentFolderId: params.parent_folder_id,
        folderType: params.folder_type ?? 'app',
      },
    });
    return { folder: mapFolder(data.folder ?? {}) };
  },
});
