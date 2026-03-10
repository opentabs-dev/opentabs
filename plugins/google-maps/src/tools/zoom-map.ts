import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildLocationUrl, getMapCenter } from '../maps-api.js';

export const zoomMap = defineTool({
  name: 'zoom_map',
  displayName: 'Zoom Map',
  description:
    'Change the zoom level of the current Google Maps view. Zoom in to see more detail or zoom out for a wider view. Zoom levels range from 1 (world) to 21 (building level). Common levels: 5 (country), 10 (city), 15 (streets), 18 (buildings), 20 (close-up).',
  summary: 'Zoom in or out on the map',
  icon: 'zoom-in',
  group: 'Map',
  input: z.object({
    zoom: z.number().int().min(1).max(21).describe('Target zoom level (1=world, 21=building detail)'),
  }),
  output: z.object({
    url: z.string().describe('Updated Google Maps URL'),
    success: z.boolean().describe('Whether the zoom change succeeded'),
  }),
  handle: async params => {
    const center = getMapCenter();
    if (!center) {
      return { url: '', success: false };
    }

    const url = `https://www.google.com${buildLocationUrl(center.lat, center.lng, params.zoom)}`;
    window.location.href = url;
    return { url, success: true };
  },
});
