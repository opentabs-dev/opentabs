import { defineTool, getCurrentUrl } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getDirectionsFromUrl } from '../maps-api.js';
import { directionRouteSchema, mapDirectionRoute } from './schemas.js';

export const getDirectionsInfo = defineTool({
  name: 'get_directions_info',
  displayName: 'Get Directions Info',
  description:
    'Get the current directions information from the Google Maps directions view. Returns origin, destination, travel mode, and the directions URL. Only works when the user is viewing directions (the URL contains /dir/).',
  summary: 'Read current directions from the map',
  icon: 'route',
  group: 'Directions',
  input: z.object({}),
  output: z.object({
    route: directionRouteSchema.nullable().describe('Current directions info, or null if not viewing directions'),
  }),
  handle: async () => {
    const dirInfo = getDirectionsFromUrl();
    if (!dirInfo) {
      return { route: null };
    }

    const url = getCurrentUrl();
    return {
      route: mapDirectionRoute({
        origin: dirInfo.origin,
        destination: dirInfo.destination,
        travel_mode: dirInfo.travelMode,
        url,
      }),
    };
  },
});
