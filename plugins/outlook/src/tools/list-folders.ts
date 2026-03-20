import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { type RawMailFolder, mailFolderSchema, mapMailFolder } from './schemas.js';

export const listFolders = defineTool({
  name: 'list_folders',
  displayName: 'List Folders',
  description:
    'List mail folders in the mailbox. Returns folder names, IDs, and unread/total counts. Use folder IDs with list_messages to read specific folders.',
  summary: 'List mail folders',
  icon: 'folder',
  group: 'Folders',
  input: z.object({
    parent_folder_id: z
      .string()
      .optional()
      .describe('Parent folder ID to list child folders. Omit for top-level folders.'),
    include_hidden: z.boolean().optional().describe('Include hidden folders (default: false)'),
  }),
  output: z.object({
    folders: z.array(mailFolderSchema).describe('Mail folders'),
  }),
  handle: async params => {
    const endpoint = params.parent_folder_id
      ? `/me/mailFolders/${params.parent_folder_id}/childFolders`
      : '/me/mailFolders';
    const data = await api<{ value: RawMailFolder[] }>(endpoint, {
      query: {
        $select: 'id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount',
        $top: 50,
        includeHiddenFolders: params.include_hidden ? 'true' : undefined,
      },
    });
    return { folders: (data.value ?? []).map(mapMailFolder) };
  },
});
