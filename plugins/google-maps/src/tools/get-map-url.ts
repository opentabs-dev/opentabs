import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildDirectionsUrl, buildLocationUrl, buildPlaceUrl, buildSearchUrl } from '../maps-api.js';

export const getMapUrl = defineTool({
  name: 'get_map_url',
  displayName: 'Get Map URL',
  description:
    'Build a Google Maps URL without navigating. Useful for generating links to include in messages, emails, or documents. Supports location, search, place, and directions URLs.',
  summary: 'Build a Maps URL without navigating',
  icon: 'link',
  group: 'Sharing',
  input: z.object({
    type: z.enum(['location', 'search', 'place', 'directions']).describe('Type of Maps URL to generate'),
    query: z
      .string()
      .optional()
      .describe('Search query or place name (required for search, place, and directions types)'),
    lat: z.number().optional().describe('Latitude (for location type)'),
    lng: z.number().optional().describe('Longitude (for location type)'),
    zoom: z.number().int().min(1).max(21).optional().describe('Zoom level for location type (default 15)'),
    origin: z.string().optional().describe('Origin for directions (required for directions type)'),
    destination: z.string().optional().describe('Destination for directions (required for directions type)'),
    travel_mode: z
      .enum(['driving', 'transit', 'walking', 'bicycling'])
      .optional()
      .describe('Travel mode for directions (default "driving")'),
  }),
  output: z.object({
    url: z.string().describe('The generated Google Maps URL'),
  }),
  handle: async params => {
    let path: string;

    switch (params.type) {
      case 'location': {
        const lat = params.lat ?? 0;
        const lng = params.lng ?? 0;
        const zoom = params.zoom ?? 15;
        path = buildLocationUrl(lat, lng, zoom);
        break;
      }
      case 'search': {
        path = buildSearchUrl(params.query ?? '', params.lat, params.lng, params.zoom);
        break;
      }
      case 'place': {
        path = buildPlaceUrl(params.query ?? '');
        break;
      }
      case 'directions': {
        const origin = params.origin ?? '';
        const destination = params.destination ?? params.query ?? '';
        const mode = params.travel_mode ?? 'driving';
        path = buildDirectionsUrl(origin, destination, mode);
        break;
      }
    }

    return { url: `https://www.google.com${path}` };
  },
});
