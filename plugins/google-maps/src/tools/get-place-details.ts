import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildPlaceUrl, extractEmbeddedData, fetchPageData } from '../maps-api.js';
import { mapPlaceDetail, placeDetailSchema } from './schemas.js';
import type { RawPlaceDetail } from './schemas.js';

const extractPlaceFromState = (state: unknown[], query: string, url: string): RawPlaceDetail => {
  const data = extractEmbeddedData(state);
  if (!data) return { name: query, url };

  const firstEntry = data[0];
  if (!Array.isArray(firstEntry) || firstEntry.length < 2) {
    return { name: query, url };
  }

  // Place data structure: [0] = placeId (hex or null), [1] = name, [2] = viewport with coords
  // When searching by name, [0] is often null; the place ID may be in [0] as "hex:hex" format
  const placeId = typeof firstEntry[0] === 'string' ? firstEntry[0] : '';
  const name = typeof firstEntry[1] === 'string' ? firstEntry[1] : query;

  // Coordinates are in the viewport array at [2]: [[distance, lng, lat], ...]
  let lat = 0;
  let lng = 0;
  const viewport = firstEntry[2];
  if (Array.isArray(viewport) && Array.isArray(viewport[0]) && viewport[0].length >= 3) {
    const coords = viewport[0];
    if (typeof coords[2] === 'number') lat = coords[2];
    if (typeof coords[1] === 'number') lng = coords[1];
  }

  // For specific place pages with coordinates at [3]: [null, null, lat, lng]
  const coords3 = firstEntry[3];
  if (Array.isArray(coords3) && coords3.length >= 4) {
    if (typeof coords3[2] === 'number' && typeof coords3[3] === 'number') {
      lat = coords3[2];
      lng = coords3[3];
    }
  }

  return { name, place_id: placeId, lat, lng, url };
};

export const getPlaceDetails = defineTool({
  name: 'get_place_details',
  displayName: 'Get Place Details',
  description:
    'Get details about a place on Google Maps by name or address. Fetches the place page and extracts available information including name, coordinates, and place ID. For complete details (hours, phone, reviews), use navigate_to_place to open the place in the browser.',
  summary: 'Get place info by name or address',
  icon: 'map-pin',
  group: 'Places',
  input: z.object({
    query: z
      .string()
      .describe('Place name or address (e.g., "Statue of Liberty", "1600 Pennsylvania Ave NW, Washington, DC")'),
  }),
  output: z.object({
    place: placeDetailSchema,
  }),
  handle: async params => {
    const path = buildPlaceUrl(params.query);
    const fullPath = `${path}?authuser=0&hl=en&gl=us&entry=ttu`;

    const { state } = await fetchPageData(fullPath);
    const raw = extractPlaceFromState(state, params.query, `https://www.google.com${path}`);

    return { place: mapPlaceDetail(raw) };
  },
});
