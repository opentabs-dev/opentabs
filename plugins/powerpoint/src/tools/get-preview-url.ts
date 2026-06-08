import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';

export const getPreviewUrl = defineTool({
  name: 'get_preview_url',
  displayName: 'Get Preview URL',
  description:
    'Get an embeddable preview URL for a file. The URL can be used to embed a read-only preview of the presentation in an iframe.',
  summary: 'Get an embeddable preview URL',
  icon: 'eye',
  group: 'Presentations',
  input: z.object({
    item_id: z.string().describe('Item ID of the file'),
  }),
  output: z.object({
    url: z.string().describe('Embeddable preview URL'),
  }),
  handle: async params => {
    const driveId = await getCurrentDriveId();
    const data = await api<{ getUrl?: string }>(`/drives/${driveId}/items/${params.item_id}/preview`, {
      method: 'POST',
      body: {},
    });
    return { url: data.getUrl ?? '' };
  },
});
