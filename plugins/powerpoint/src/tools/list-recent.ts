import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../powerpoint-api.js';
import { driveItemSchema, type GraphCollection, mapDriveItem, type RawDriveItem } from './schemas.js';

export const listRecent = defineTool({
  name: 'list_recent',
  displayName: 'List Recent Files',
  description:
    'List recently accessed files across OneDrive. Returns the most recently viewed or edited files with their metadata.',
  summary: 'List recently accessed files',
  icon: 'clock',
  group: 'Files',
  input: z.object({
    top: z.number().int().min(1).max(50).optional().describe('Max items to return (default 10, max 50)'),
  }),
  output: z.object({
    items: z.array(driveItemSchema).describe('Recently accessed files'),
  }),
  handle: async params => {
    const data = await api<GraphCollection<RawDriveItem>>('/me/drive/recent', {
      query: { $top: params.top ?? 10 },
    });
    return { items: (data.value ?? []).map(mapDriveItem) };
  },
});
