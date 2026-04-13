import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi, getUserId } from '../lucid-api.js';
import { type RawFolderEntry, mapFolderEntry, folderEntrySchema } from './schemas.js';

export const getFolderEntry = defineTool({
  name: 'get_folder_entry',
  displayName: 'Get Folder Entry',
  description:
    'Get details of a specific folder entry by its ID, including name, parent, associated document, and project status.',
  summary: 'Get folder entry details',
  icon: 'folder-open',
  group: 'Folders',
  input: z.object({
    entry_id: z.string().describe('Folder entry ID'),
  }),
  output: z.object({ entry: folderEntrySchema }),
  handle: async params => {
    const userId = getUserId();
    const data = await docsApi<RawFolderEntry>(`/users/${userId}/folderEntries/${params.entry_id}`);
    return { entry: mapFolderEntry(data) };
  },
});
