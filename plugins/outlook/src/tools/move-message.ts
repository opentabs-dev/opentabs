import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

export const moveMessage = defineTool({
  name: 'move_message',
  displayName: 'Move Message',
  description:
    'Move an email message to a different folder. Use well-known names (Inbox, Archive, DeletedItems, Drafts, JunkEmail, SentItems) or folder IDs from list_folders.',
  summary: 'Move email to folder',
  icon: 'folder-input',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID to move'),
    destination_folder_id: z.string().describe('Destination folder ID or well-known name'),
  }),
  output: z.object({
    new_message_id: z.string().describe('The message ID in its new location'),
  }),
  handle: async params => {
    const data = await api<{ id: string }>(`/me/messages/${params.message_id}/move`, {
      method: 'POST',
      body: { destinationId: params.destination_folder_id },
    });
    return { new_message_id: data.id ?? '' };
  },
});
