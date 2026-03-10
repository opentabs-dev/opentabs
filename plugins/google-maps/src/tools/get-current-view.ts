import { defineTool, getCurrentUrl } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getMapCenter, getSearchQuery } from '../maps-api.js';
import { mapViewSchema } from './schemas.js';

export const getCurrentView = defineTool({
  name: 'get_current_view',
  displayName: 'Get Current View',
  description:
    'Get the current Google Maps view including center coordinates, zoom level, active search query, and the current URL. Use this to understand what the user is currently looking at.',
  summary: 'Get current map center, zoom, and query',
  icon: 'map',
  group: 'Map',
  input: z.object({}),
  output: z.object({
    view: mapViewSchema,
  }),
  handle: async () => {
    const center = getMapCenter();
    const query = getSearchQuery();
    const url = getCurrentUrl();

    return {
      view: {
        lat: center?.lat ?? 0,
        lng: center?.lng ?? 0,
        zoom: center?.zoom ?? 0,
        query: query ?? '',
        url,
      },
    };
  },
});
