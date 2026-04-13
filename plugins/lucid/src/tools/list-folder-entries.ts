import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi, getUserId } from '../lucid-api.js';
import { type RawFolderEntry, mapFolderEntry, folderEntrySchema } from './schemas.js';

export const listFolderEntries = defineTool({
  name: 'list_folder_entries',
  displayName: 'List Folder Entries',
  description:
    'List folder entries for the current user. Includes both folders and document entries. Optionally filter by parent folder to list children of a specific folder.',
  summary: 'List folders and document entries',
  icon: 'folder',
  group: 'Folders',
  input: z.object({
    parent_id: z
      .string()
      .optional()
      .describe('Parent folder entry ID to list children of. Omit for root-level entries.'),
  }),
  output: z.object({
    entries: z.array(folderEntrySchema),
  }),
  handle: async params => {
    const userId = getUserId();
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params.parent_id) query.parent = params.parent_id;
    const data = await docsApi<RawFolderEntry[]>(`/users/${userId}/folderEntries/chart`, { query });
    return { entries: data.map(mapFolderEntry) };
  },
});
