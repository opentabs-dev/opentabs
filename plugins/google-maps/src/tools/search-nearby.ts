import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildSearchUrl, getMapCenter } from '../maps-api.js';

export const searchNearby = defineTool({
  name: 'search_nearby',
  displayName: 'Search Nearby',
  description:
    'Open a Google Maps search for a category of places near specific coordinates. Navigates the browser to show results on the map. Common categories: restaurants, hotels, gas stations, coffee, pharmacies, ATMs, grocery stores, parking, hospitals, banks.',
  summary: 'Search by category near coordinates',
  icon: 'compass',
  group: 'Search',
  input: z.object({
    category: z.string().describe('Category to search for (e.g., "restaurants", "gas stations", "coffee shops")'),
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

    const query = `${params.category} nearby`;
    const path = buildSearchUrl(query, lat, lng, zoom);
    const fullUrl = `https://www.google.com${path}`;
    window.location.href = fullUrl;
    return { url: fullUrl, success: true };
  },
});
