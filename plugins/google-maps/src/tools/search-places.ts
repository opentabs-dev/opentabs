import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getMapCenter, searchPlaces } from '../maps-api.js';
import { mapPlaceSearchResult, placeSearchResultSchema } from './schemas.js';
import type { RawPlaceSearchResult } from './schemas.js';

const parsePlaceIds = (rawJson: string): string[] => {
  try {
    const data = JSON.parse(rawJson) as unknown[];
    const fullStr = JSON.stringify(data);
    const matches = fullStr.match(/0x[0-9a-f]+:0x[0-9a-f]+/g);
    return matches ? [...new Set(matches)] : [];
  } catch {
    return [];
  }
};

export const searchPlacesTool = defineTool({
  name: 'search_places',
  displayName: 'Search Places',
  description:
    'Search for places on Google Maps by text query near a location. Returns place names and IDs. Use get_current_view first to get coordinates for the search area, or provide explicit coordinates.',
  summary: 'Search for places near a location',
  icon: 'search',
  group: 'Search',
  input: z.object({
    query: z.string().describe('Search query (e.g., "coffee shops", "restaurants Italian", "gas station")'),
    lat: z.number().optional().describe('Latitude for search center. Uses current map center if omitted.'),
    lng: z.number().optional().describe('Longitude for search center. Uses current map center if omitted.'),
    radius: z.number().int().optional().describe('Search radius in meters (default 5000)'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum number of results to return (default 10, max 20)'),
  }),
  output: z.object({
    places: z.array(placeSearchResultSchema).describe('List of matching places'),
    query: z.string().describe('The search query used'),
  }),
  handle: async params => {
    const center = getMapCenter();
    const lat = params.lat ?? center?.lat ?? 37.7749;
    const lng = params.lng ?? center?.lng ?? -122.4194;
    const radius = params.radius ?? 5000;
    const maxResults = params.max_results ?? 10;

    const rawJson = await searchPlaces(params.query, lat, lng, radius, maxResults);
    const placeIds = parsePlaceIds(rawJson);

    const places: RawPlaceSearchResult[] = placeIds.map(id => ({
      place_id: id,
      name: '',
      lat,
      lng,
    }));

    return {
      places: places.map(mapPlaceSearchResult),
      query: params.query,
    };
  },
});
