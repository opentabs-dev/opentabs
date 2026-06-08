import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { folderSchema, mapFolder, type RawFolder } from './schemas.js';

export const renameFolder = defineTool({
  name: 'rename_folder',
  displayName: 'Rename Folder',
  description: 'Rename an existing folder. Use list_apps to find folder IDs.',
  summary: 'Rename an app or workflow folder',
  icon: 'pencil',
  group: 'Apps',
  input: z.object({
    folder_id: z.number().describe('Folder ID to rename'),
    new_name: z.string().describe('New name for the folder'),
  }),
  output: z.object({ folder: folderSchema }),
  handle: async params => {
    const data = await api<{ folder: RawFolder }>('/api/folders/renameFolder', {
      method: 'POST',
      body: {
        folderId: params.folder_id,
        folderName: params.new_name,
      },
    });
    return { folder: mapFolder(data.folder ?? {}) };
  },
});
