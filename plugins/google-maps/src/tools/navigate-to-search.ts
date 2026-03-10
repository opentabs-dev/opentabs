import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildSearchUrl, getMapCenter } from '../maps-api.js';

export const navigateToSearch = defineTool({
  name: 'navigate_to_search',
  displayName: 'Navigate to Search',
  description:
    'Open Google Maps search results for a query at a specific location. The map shows search results pinned on the map with a list panel. Optionally provide coordinates to search near a specific location.',
  summary: 'Open search results on the map',
  icon: 'search',
  group: 'Navigation',
  input: z.object({
    query: z.string().describe('Search query (e.g., "restaurants", "hotels near airport", "Starbucks")'),
    lat: z.number().optional().describe('Latitude for search center. Uses current map center if omitted.'),
    lng: z.number().optional().describe('Longitude for search center. Uses current map center if omitted.'),
    zoom: z.number().int().min(1).max(21).optional().describe('Zoom level (1-21, default 15)'),
  }),
  output: z.object({
    url: z.string().describe('The Google Maps search URL navigated to'),
    success: z.boolean().describe('Whether the navigation succeeded'),
  }),
  handle: async params => {
    const center = getMapCenter();
    const lat = params.lat ?? center?.lat;
    const lng = params.lng ?? center?.lng;
    const zoom = params.zoom ?? center?.zoom;
    const path = buildSearchUrl(params.query, lat, lng, zoom);
    const fullUrl = `https://www.google.com${path}`;
    window.location.href = fullUrl;
    return { url: fullUrl, success: true };
  },
});
