import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';
import { DRIVE_ITEM_SELECT, driveItemSchema, mapDriveItem, type RawDriveItem } from './schemas.js';

export const getItem = defineTool({
  name: 'get_item',
  displayName: 'Get File Info',
  description:
    'Get detailed information about a file or folder by its item ID. Returns name, size, MIME type, creation/modification details, and web URL.',
  summary: 'Get details of a file or folder',
  icon: 'file',
  group: 'Files',
  input: z.object({
    item_id: z.string().describe('Item ID of the file or folder'),
  }),
  output: z.object({
    item: driveItemSchema.describe('File or folder details'),
  }),
  handle: async params => {
    const driveId = await getCurrentDriveId();
    const data = await api<RawDriveItem>(`/drives/${driveId}/items/${params.item_id}`, {
      query: { $select: DRIVE_ITEM_SELECT },
    });
    return { item: mapDriveItem(data) };
  },
});
