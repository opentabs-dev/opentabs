import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';
import { driveItemSchema, mapDriveItem, type RawDriveItem } from './schemas.js';

export const moveItem = defineTool({
  name: 'move_item',
  displayName: 'Move File',
  description: 'Move a file or folder to a different folder in OneDrive. Returns the updated item details.',
  summary: 'Move a file or folder',
  icon: 'folder-input',
  group: 'Files',
  input: z.object({
    item_id: z.string().describe('Item ID of the file or folder to move'),
    destination_folder_id: z.string().describe('Destination folder item ID'),
  }),
  output: z.object({
    item: driveItemSchema.describe('Moved file or folder details'),
  }),
  handle: async params => {
    const driveId = await getCurrentDriveId();
    const data = await api<RawDriveItem>(`/drives/${driveId}/items/${params.item_id}`, {
      method: 'PATCH',
      body: { parentReference: { id: params.destination_folder_id } },
    });
    return { item: mapDriveItem(data) };
  },
});
