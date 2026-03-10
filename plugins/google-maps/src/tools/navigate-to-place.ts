import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildPlaceUrl } from '../maps-api.js';

export const navigateToPlace = defineTool({
  name: 'navigate_to_place',
  displayName: 'Navigate to Place',
  description:
    'Navigate Google Maps to a specific place by name or address. Opens the place detail view showing information like hours, reviews, and photos.',
  summary: 'Open a place on the map',
  icon: 'map-pin',
  group: 'Navigation',
  input: z.object({
    query: z.string().describe('Place name or address (e.g., "Golden Gate Bridge", "1600 Amphitheatre Parkway")'),
  }),
  output: z.object({
    url: z.string().describe('The Google Maps place URL navigated to'),
    success: z.boolean().describe('Whether the navigation succeeded'),
  }),
  handle: async params => {
    const path = buildPlaceUrl(params.query);
    const fullUrl = `https://www.google.com${path}`;
    window.location.href = fullUrl;
    return { url: fullUrl, success: true };
  },
});
