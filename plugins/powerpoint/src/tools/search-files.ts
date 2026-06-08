import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../powerpoint-api.js';
import {
  DRIVE_ITEM_SELECT,
  driveItemSchema,
  type GraphCollection,
  mapDriveItem,
  type RawDriveItem,
} from './schemas.js';

export const searchFiles = defineTool({
  name: 'search_files',
  displayName: 'Search Files',
  description: 'Search for files and folders in OneDrive by name. Returns matching items sorted by relevance.',
  summary: 'Search files by name',
  icon: 'search',
  group: 'Files',
  input: z.object({
    query: z.string().describe('Search query text'),
    top: z.number().int().min(1).max(50).optional().describe('Max results (default 10, max 50)'),
  }),
  output: z.object({
    items: z.array(driveItemSchema).describe('Matching files and folders'),
  }),
  handle: async params => {
    const q = encodeURIComponent(params.query);
    const data = await api<GraphCollection<RawDriveItem>>(`/me/drive/root/search(q='${q}')`, {
      query: {
        $top: params.top ?? 10,
        $select: DRIVE_ITEM_SELECT,
      },
    });
    return { items: (data.value ?? []).map(mapDriveItem) };
  },
});
