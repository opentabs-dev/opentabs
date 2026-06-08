import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../powerpoint-api.js';
import { driveItemSchema, type GraphCollection, mapDriveItem, type RawDriveItem } from './schemas.js';

export const listSharedWithMe = defineTool({
  name: 'list_shared_with_me',
  displayName: 'List Shared With Me',
  description: 'List files that other people have shared with you. Returns file metadata including who shared it.',
  summary: 'List files shared with you',
  icon: 'share-2',
  group: 'Files',
  input: z.object({
    top: z.number().int().min(1).max(50).optional().describe('Max items to return (default 10, max 50)'),
  }),
  output: z.object({
    items: z.array(driveItemSchema).describe('Shared files and folders'),
  }),
  handle: async params => {
    const data = await api<GraphCollection<RawDriveItem>>('/me/drive/sharedWithMe', {
      query: { $top: params.top ?? 10 },
    });
    return { items: (data.value ?? []).map(mapDriveItem) };
  },
});
