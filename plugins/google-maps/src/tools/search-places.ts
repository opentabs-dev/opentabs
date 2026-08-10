import { defineTool, getCurrentUrl, querySelectorAll, waitForSelector } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildSearchUrl, getMapCenter, searchPlaces } from '../maps-api.js';
import { mapPlaceSearchResult, placeSearchResultSchema } from './schemas.js';
import type { RawPlaceSearchResult } from './schemas.js';

type ParsedPlace = Pick<RawPlaceSearchResult, 'place_id' | 'name' | 'address' | 'rating' | 'review_count' | 'type' | 'open_now' | 'price_level'>;

const readRenderedPlaces = (): ParsedPlace[] =>
  querySelectorAll<HTMLElement>('div[role="feed"] [role="article"]').map(card => {
    const lines = (card.innerText || '').split('\n').map(line => line.trim()).filter(Boolean);
    const name = lines[0] ?? '';
    const ratingLine = lines.find(line => /^\d(?:\.\d)?\s*\(/.test(line)) ?? '';
    const ratingMatch = ratingLine.match(/(\d(?:\.\d)?)\s*\(([\d,]+)\)/);
    const categoryLine = lines.find(line => line.includes('·')) ?? '';
    const categoryParts = categoryLine.split('·').map(part => part.trim());
    const address = categoryParts.at(-1) ?? '';
    const type = categoryParts[0] ?? '';
    const open_now = lines.find(line => /^(Open|Closed)/i.test(line))?.split('·')[0]?.trim() ?? '';
    const price_level = lines.find(line => /^\$+\s/.test(line))?.split(' ')[0] ?? '';
    const href = card.querySelector<HTMLAnchorElement>('a[href*="/maps/place/"]')?.href ?? '';
    const place_id = href.match(/!1s(0x[0-9a-f]+%3A0x[0-9a-f]+)/i)?.[1]?.replace('%3A', ':') ?? '';
    const rating = ratingMatch?.[1] ? Number(ratingMatch[1]) : 0;
    const review_count = ratingMatch?.[2] ? Number(ratingMatch[2].replace(/,/g, '')) : 0;
    return {
      place_id,
      name,
      address,
      rating,
      review_count,
      type,
      open_now,
      price_level,
    };
  });

export const searchPlacesTool = defineTool({
  name: 'search_places',
  displayName: 'Search Places',
  description: 'Search for places on Google Maps and return names, addresses, IDs, ratings, review counts, categories, open status, and price level when visible.',
  summary: 'Search for places near a location',
  icon: 'search',
  group: 'Search',
  input: z.object({
    query: z.string().describe('Search query'),
    lat: z.number().optional().describe('Latitude for search center'),
    lng: z.number().optional().describe('Longitude for search center'),
    radius: z.number().int().optional().describe('Search radius in meters (default 5000)'),
    max_results: z.number().int().min(1).max(20).optional().describe('Maximum results (default 10)'),
  }),
  output: z.object({ places: z.array(placeSearchResultSchema), query: z.string() }),
  handle: async params => {
    const center = getMapCenter();
    const lat = params.lat ?? center?.lat ?? 37.7749;
    const lng = params.lng ?? center?.lng ?? -122.4194;
    const radius = params.radius ?? 5000;
    const maxResults = params.max_results ?? 10;
    const queryPath = params.query.trim().replace(/\s+/g, '+');
    if (!getCurrentUrl().includes(`/maps/search/${queryPath}`)) {
      window.location.href = buildSearchUrl(params.query, lat, lng, 14);
      await waitForSelector('div[role="feed"] [role="article"]', { timeout: 10000 });
    }
    const rendered = readRenderedPlaces().slice(0, maxResults);
    const rawJson = await searchPlaces(params.query, lat, lng, radius, maxResults);
    const ids = [...new Set(rawJson.match(/0x[0-9a-f]+:0x[0-9a-f]+/g) ?? [])];
    const places: RawPlaceSearchResult[] = rendered.map((place, index) => ({ ...place, place_id: place.place_id || ids[index] || '', lat, lng }));
    return { places: places.map(mapPlaceSearchResult), query: params.query };
  },
});
