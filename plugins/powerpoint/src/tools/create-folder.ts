import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';
import { driveItemSchema, mapDriveItem, type RawDriveItem } from './schemas.js';

export const createFolder = defineTool({
  name: 'create_folder',
  displayName: 'Create Folder',
  description:
    'Create a new folder in OneDrive. Specify a name and optional parent folder. Returns the created folder details.',
  summary: 'Create a new folder',
  icon: 'folder-plus',
  group: 'Files',
  input: z.object({
    name: z.string().describe('Folder name'),
    parent_folder_id: z.string().optional().describe('Parent folder item ID — defaults to root'),
  }),
  output: z.object({
    item: driveItemSchema.describe('Created folder details'),
  }),
  handle: async params => {
    const driveId = await getCurrentDriveId();
    const parentPath = params.parent_folder_id ? `items/${params.parent_folder_id}` : 'root';
    const data = await api<RawDriveItem>(`/drives/${driveId}/${parentPath}/children`, {
      method: 'POST',
      body: {
        name: params.name,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      },
    });
    return { item: mapDriveItem(data) };
  },
});
