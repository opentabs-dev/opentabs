import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi, getUserId } from '../lucid-api.js';
import { type RawFolderEntry, mapFolderEntry, folderEntrySchema } from './schemas.js';

export const createFolder = defineTool({
  name: 'create_folder',
  displayName: 'Create Folder',
  description:
    'Create a new folder to organize documents. Optionally specify a parent folder to create a nested folder.',
  summary: 'Create a new folder',
  icon: 'folder-plus',
  group: 'Folders',
  input: z.object({
    name: z.string().describe('Folder name'),
    parent_id: z.string().optional().describe('Parent folder entry ID for nesting. Omit for root-level folder.'),
  }),
  output: z.object({ folder: folderEntrySchema }),
  handle: async params => {
    const userId = getUserId();
    const body: Record<string, unknown> = {
      user: `https://users.lucid.app/users/${userId}`,
      name: params.name,
      type: 'folder',
    };
    if (params.parent_id) {
      body.parent = `https://documents.lucid.app/users/${userId}/folderEntries/${params.parent_id}`;
    }
    const data = await docsApi<RawFolderEntry>(`/users/${userId}/folderEntries/chart`, { method: 'POST', body });
    return { folder: mapFolderEntry(data) };
  },
});
