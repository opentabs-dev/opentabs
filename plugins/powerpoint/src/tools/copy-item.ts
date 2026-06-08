import { defineTool, stripUndefined } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';

export const copyItem = defineTool({
  name: 'copy_item',
  displayName: 'Copy File',
  description:
    'Create a copy of a file in OneDrive. Optionally specify a new name and destination folder. The copy operation runs asynchronously.',
  summary: 'Copy a file to a new location',
  icon: 'copy',
  group: 'Files',
  input: z.object({
    item_id: z.string().describe('Item ID of the file to copy'),
    name: z.string().optional().describe('Name for the copy (defaults to "original name (copy)")'),
    destination_folder_id: z.string().optional().describe('Destination folder item ID — defaults to same folder'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the copy was initiated (runs asynchronously)'),
  }),
  handle: async params => {
    const driveId = await getCurrentDriveId();
    const body = stripUndefined({
      name: params.name,
      parentReference: params.destination_folder_id ? { id: params.destination_folder_id } : undefined,
    });
    await api(`/drives/${driveId}/items/${params.item_id}/copy`, {
      method: 'POST',
      body,
    });
    return { success: true };
  },
});
