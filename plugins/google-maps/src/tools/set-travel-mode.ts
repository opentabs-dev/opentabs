import { defineTool, getCurrentUrl } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildDirectionsUrl, getDirectionsFromUrl } from '../maps-api.js';

export const setTravelMode = defineTool({
  name: 'set_travel_mode',
  displayName: 'Set Travel Mode',
  description:
    'Change the travel mode for the current directions view. Only works when viewing directions (URL contains /dir/). Switches between driving, transit, walking, and bicycling modes.',
  summary: 'Switch driving/transit/walking/biking',
  icon: 'car',
  group: 'Directions',
  input: z.object({
    travel_mode: z.enum(['driving', 'transit', 'walking', 'bicycling']).describe('Travel mode to switch to'),
  }),
  output: z.object({
    url: z.string().describe('Updated Google Maps directions URL'),
    success: z.boolean().describe('Whether the mode change succeeded'),
  }),
  handle: async params => {
    const dirInfo = getDirectionsFromUrl();
    if (!dirInfo) {
      return {
        url: getCurrentUrl(),
        success: false,
      };
    }

    const path = buildDirectionsUrl(dirInfo.origin, dirInfo.destination, params.travel_mode);
    const fullUrl = `https://www.google.com${path}`;
    window.location.href = fullUrl;
    return { url: fullUrl, success: true };
  },
});
