import { defineTool, getCurrentUrl, querySelectorAll, waitForSelector } from '@opentabs-dev/plugin-sdk';
import type { ToolHandlerContext } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { buildSearchUrl, getMapCenter } from '../maps-api.js';
import { mapPlaceSearchResult, placeSearchResultSchema } from './schemas.js';
import type { RawPlaceSearchResult } from './schemas.js';

type ParsedPlace = Pick<RawPlaceSearchResult, 'place_id' | 'name' | 'address' | 'rating' | 'review_count' | 'type' | 'open_now' | 'price_level'>;

const readRenderedPlaces = (): ParsedPlace[] =>
  querySelectorAll<HTMLElement>('div[role="feed"] [role="article"]').map(card => {
    const lines = (card.innerText || '').split('\n').map(line => line.trim()).filter(Boolean);
    const name = lines[0] ?? '';
    const ratingLine = lines.find(line => /^\d(?:\.\d)?\s*\(/.test(line)) ?? '';
    const ratingMatch = ratingLine.match(/(\d(?:\.\d)?)\s*\(([\d,.]+)\s*([KM]?)\)/i);
    const reviewCountValue = ratingMatch?.[2]?.replace(/,/g, '') ?? '';
    const reviewCountSuffix = ratingMatch?.[3]?.toUpperCase() ?? '';
    const reviewCountMultiplier = reviewCountSuffix === 'M' ? 1_000_000 : reviewCountSuffix === 'K' ? 1_000 : 1;
    const categoryParts = (lines.find(line => line.includes('·')) ?? '').split('·').map(part => part.trim());
    const address = categoryParts.at(-1) ?? '';
    const type = categoryParts[0] ?? '';
    const openNow = lines.find(line => /^(Open|Closed)/i.test(line))?.split('·')[0]?.trim() ?? '';
    const priceLevel = lines.find(line => /^\$+\s/.test(line))?.split(' ')[0] ?? '';
    const href = card.querySelector<HTMLAnchorElement>('a[href*="/maps/place/"]')?.href ?? '';
    const placeId = href.match(/!1s(0x[0-9a-f]+%3A0x[0-9a-f]+)/i)?.[1]?.replace('%3A', ':') ?? '';
    return {
      place_id: placeId,
      name,
      address,
      rating: ratingMatch?.[1] ? Number(ratingMatch[1]) : 0,
      review_count: reviewCountValue ? Number(reviewCountValue) * reviewCountMultiplier : 0,
      type,
      open_now: openNow,
      price_level: priceLevel,
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
    query: z.string().trim().min(1).describe('Search query'),
    lat: z.number().min(-90).max(90).optional().describe('Latitude for search center'),
    lng: z.number().min(-180).max(180).optional().describe('Longitude for search center'),
    radius: z.number().int().min(1).optional().describe('Search radius in meters (default 5000)'),
    max_results: z.number().int().min(1).max(20).optional().describe('Maximum results (default 10)'),
  }),
  output: z.object({ places: z.array(placeSearchResultSchema), query: z.string() }),
  handle: async (params, context?: ToolHandlerContext) => {
    const center = getMapCenter();
    const lat = params.lat ?? center?.lat ?? 37.7749;
    const lng = params.lng ?? center?.lng ?? -122.4194;
    const radius = params.radius ?? 5000;
    const maxResults = params.max_results ?? 10;
    const searchUrl = buildSearchUrl(params.query, lat, lng, 14);
    const targetPath = new URL(searchUrl, window.location.origin).pathname;
    context?.reportProgress({ message: 'Opening Google Maps search' });
    if (new URL(getCurrentUrl()).pathname !== targetPath) window.location.href = searchUrl;
    context?.reportProgress({ message: 'Waiting for result cards' });
    await waitForSelector('div[role="feed"] [role="article"]', { timeout: 10000 });
    const rendered = readRenderedPlaces().slice(0, maxResults);
    context?.reportProgress({ message: 'Parsing result details', progress: 1, total: 1 });
    const places: RawPlaceSearchResult[] = rendered.map(place => ({ ...place, lat, lng }));
    return { places: places.map(mapPlaceSearchResult), query: params.query };
  },
});
