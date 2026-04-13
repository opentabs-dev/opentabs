import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi, getUserId } from '../lucid-api.js';
import { type RawFolderEntry, mapFolderEntry, folderEntrySchema } from './schemas.js';

export const moveDocumentToFolder = defineTool({
  name: 'move_document_to_folder',
  displayName: 'Move Document to Folder',
  description:
    'Create a folder entry that links a document to a folder. This effectively moves or adds the document to the specified folder.',
  summary: 'Move a document into a folder',
  icon: 'folder-input',
  group: 'Folders',
  input: z.object({
    document_id: z.string().describe('Document UUID to move'),
    folder_id: z.string().describe('Target folder entry ID'),
  }),
  output: z.object({ entry: folderEntrySchema }),
  handle: async params => {
    const userId = getUserId();
    const body = {
      user: `https://users.lucid.app/users/${userId}`,
      document: `https://documents.lucid.app/documents/${params.document_id}`,
      parent: `https://documents.lucid.app/users/${userId}/folderEntries/${params.folder_id}`,
    };
    const data = await docsApi<RawFolderEntry>(`/users/${userId}/folderEntries/chart`, { method: 'POST', body });
    return { entry: mapFolderEntry(data) };
  },
});
