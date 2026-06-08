import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';
import { type GraphCollection, mapThumbnail, type RawThumbnailSet, thumbnailSchema } from './schemas.js';

export const getThumbnails = defineTool({
  name: 'get_thumbnails',
  displayName: 'Get Thumbnails',
  description:
    'Get thumbnail preview images for a file. Returns URLs for small, medium, and large thumbnails. Useful for previewing presentations without opening them.',
  summary: 'Get thumbnail previews of a file',
  icon: 'image',
  group: 'Files',
  input: z.object({
    item_id: z.string().describe('Item ID of the file'),
  }),
  output: z.object({
    thumbnails: z
      .array(
        z.object({
          small: thumbnailSchema.describe('Small thumbnail'),
          medium: thumbnailSchema.describe('Medium thumbnail'),
          large: thumbnailSchema.describe('Large thumbnail'),
        }),
      )
      .describe('Thumbnail sets'),
  }),
  handle: async params => {
    const driveId = await getCurrentDriveId();
    const data = await api<GraphCollection<RawThumbnailSet>>(`/drives/${driveId}/items/${params.item_id}/thumbnails`);
    return {
      thumbnails: (data.value ?? []).map(set => ({
        small: mapThumbnail(set.small ?? {}),
        medium: mapThumbnail(set.medium ?? {}),
        large: mapThumbnail(set.large ?? {}),
      })),
    };
  },
});
