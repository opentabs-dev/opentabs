import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildDirectionsUrl } from '../maps-api.js';

export const navigateToDirections = defineTool({
  name: 'navigate_to_directions',
  displayName: 'Navigate to Directions',
  description:
    'Open Google Maps directions between an origin and destination. Shows the route on the map with step-by-step navigation instructions, distance, and estimated travel time. Supports driving, transit, walking, and bicycling modes.',
  summary: 'Open directions between two points',
  icon: 'route',
  group: 'Navigation',
  input: z.object({
    origin: z
      .string()
      .describe(
        'Starting point — address, place name, or "lat,lng" coordinates (e.g., "San Francisco", "37.7749,-122.4194")',
      ),
    destination: z.string().describe('End point — address, place name, or "lat,lng" coordinates'),
    travel_mode: z
      .enum(['driving', 'transit', 'walking', 'bicycling'])
      .optional()
      .describe('Travel mode (default "driving")'),
  }),
  output: z.object({
    url: z.string().describe('The Google Maps directions URL navigated to'),
    success: z.boolean().describe('Whether the navigation succeeded'),
  }),
  handle: async params => {
    const mode = params.travel_mode ?? 'driving';
    const path = buildDirectionsUrl(params.origin, params.destination, mode);
    const fullUrl = `https://www.google.com${path}`;
    window.location.href = fullUrl;
    return { url: fullUrl, success: true };
  },
});
