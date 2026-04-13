import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi, getUserId } from '../lucid-api.js';

export const deleteFolder = defineTool({
  name: 'delete_folder',
  displayName: 'Delete Folder',
  description:
    'Permanently delete a folder entry. Documents inside the folder are not deleted — they are moved to the root level.',
  summary: 'Delete a folder',
  icon: 'folder-x',
  group: 'Folders',
  input: z.object({
    entry_id: z.string().describe('Folder entry ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
  }),
  handle: async params => {
    const userId = getUserId();
    await docsApi(`/users/${userId}/folderEntries/${params.entry_id}`, {
      method: 'DELETE',
    });
    return { success: true };
  },
});
