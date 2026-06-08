import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';
import { driveItemSchema, mapDriveItem, type RawDriveItem } from './schemas.js';

export const renameItem = defineTool({
  name: 'rename_item',
  displayName: 'Rename File',
  description: 'Rename a file or folder in OneDrive by its item ID. Returns the updated item details.',
  summary: 'Rename a file or folder',
  icon: 'pencil',
  group: 'Files',
  input: z.object({
    item_id: z.string().describe('Item ID of the file or folder'),
    name: z.string().describe('New name including file extension (e.g., "My Presentation.pptx")'),
  }),
  output: z.object({
    item: driveItemSchema.describe('Updated file or folder details'),
  }),
  handle: async params => {
    const driveId = await getCurrentDriveId();
    const data = await api<RawDriveItem>(`/drives/${driveId}/items/${params.item_id}`, {
      method: 'PATCH',
      body: { name: params.name },
    });
    return { item: mapDriveItem(data) };
  },
});
