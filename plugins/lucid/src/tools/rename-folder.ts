import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi, getUserId } from '../lucid-api.js';
import { type RawFolderEntry, mapFolderEntry, folderEntrySchema } from './schemas.js';

export const renameFolder = defineTool({
  name: 'rename_folder',
  displayName: 'Rename Folder',
  description: 'Rename an existing folder by its folder entry ID.',
  summary: 'Rename a folder',
  icon: 'folder-pen',
  group: 'Folders',
  input: z.object({
    entry_id: z.string().describe('Folder entry ID to rename'),
    name: z.string().describe('New folder name'),
  }),
  output: z.object({ folder: folderEntrySchema }),
  handle: async params => {
    const userId = getUserId();
    const data = await docsApi<RawFolderEntry>(`/users/${userId}/folderEntries/${params.entry_id}`, {
      method: 'PUT',
      body: { name: params.name },
    });
    return { folder: mapFolderEntry(data) };
  },
});
