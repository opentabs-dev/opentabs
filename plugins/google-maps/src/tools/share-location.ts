import { defineTool, getCurrentUrl } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildLocationUrl, getMapCenter } from '../maps-api.js';

export const shareLocation = defineTool({
  name: 'share_location',
  displayName: 'Share Location',
  description:
    'Get a shareable Google Maps URL for the current map view or a specific location. The URL can be shared with others to show the same location on Google Maps.',
  summary: 'Get a shareable Maps link',
  icon: 'share-2',
  group: 'Sharing',
  input: z.object({
    lat: z.number().optional().describe('Latitude. Uses current map center if omitted.'),
    lng: z.number().optional().describe('Longitude. Uses current map center if omitted.'),
    zoom: z.number().int().min(1).max(21).optional().describe('Zoom level (1-21). Uses current zoom if omitted.'),
  }),
  output: z.object({
    url: z.string().describe('Shareable Google Maps URL'),
    lat: z.number().describe('Latitude of the shared location'),
    lng: z.number().describe('Longitude of the shared location'),
    zoom: z.number().describe('Zoom level of the shared view'),
  }),
  handle: async params => {
    const center = getMapCenter();
    const lat = params.lat ?? center?.lat ?? 0;
    const lng = params.lng ?? center?.lng ?? 0;
    const zoom = params.zoom ?? center?.zoom ?? 15;

    if (lat === 0 && lng === 0 && !params.lat && !params.lng) {
      const currentUrl = getCurrentUrl();
      return { url: currentUrl, lat, lng, zoom };
    }

    const path = buildLocationUrl(lat, lng, zoom);
    const url = `https://www.google.com${path}`;
    return { url, lat, lng, zoom };
  },
});
