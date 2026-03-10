import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildDirectionsUrl } from '../maps-api.js';

export const getDirectionsUrl = defineTool({
  name: 'get_directions_url',
  displayName: 'Get Directions URL',
  description:
    'Generate a Google Maps directions URL between two points that can be shared. Does not navigate — just returns the URL. Useful for sharing directions in messages, emails, or documents.',
  summary: 'Generate a shareable directions link',
  icon: 'external-link',
  group: 'Sharing',
  input: z.object({
    origin: z.string().describe('Starting point — address, place name, or "lat,lng" coordinates'),
    destination: z.string().describe('End point — address, place name, or "lat,lng" coordinates'),
    travel_mode: z
      .enum(['driving', 'transit', 'walking', 'bicycling'])
      .optional()
      .describe('Travel mode (default "driving")'),
  }),
  output: z.object({
    url: z.string().describe('Shareable Google Maps directions URL'),
  }),
  handle: async params => {
    const mode = params.travel_mode ?? 'driving';
    const path = buildDirectionsUrl(params.origin, params.destination, mode);
    return { url: `https://www.google.com${path}` };
  },
});
