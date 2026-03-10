import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildLocationUrl } from '../maps-api.js';

export const navigateToLocation = defineTool({
  name: 'navigate_to_location',
  displayName: 'Navigate to Location',
  description:
    'Navigate the Google Maps view to specific coordinates with a given zoom level. The map pans and zooms to the specified location.',
  summary: 'Pan the map to specific coordinates',
  icon: 'navigation',
  group: 'Navigation',
  input: z.object({
    lat: z.number().describe('Latitude to navigate to'),
    lng: z.number().describe('Longitude to navigate to'),
    zoom: z
      .number()
      .int()
      .min(1)
      .max(21)
      .optional()
      .describe('Zoom level (1-21, default 15). Higher values show more detail.'),
  }),
  output: z.object({
    url: z.string().describe('The Google Maps URL navigated to'),
    success: z.boolean().describe('Whether the navigation succeeded'),
  }),
  handle: async params => {
    const zoom = params.zoom ?? 15;
    const url = buildLocationUrl(params.lat, params.lng, zoom);
    const fullUrl = `https://www.google.com${url}`;
    window.location.href = fullUrl;
    return { url: fullUrl, success: true };
  },
});
