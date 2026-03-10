import { z } from 'zod';

// --- Map view schema ---

export const mapViewSchema = z.object({
  lat: z.number().describe('Map center latitude'),
  lng: z.number().describe('Map center longitude'),
  zoom: z.number().describe('Map zoom level (1-21, higher is more detailed)'),
  query: z.string().describe('Current search query or place name, empty if none'),
  url: z.string().describe('Current Google Maps URL'),
});

// --- Place search result schema ---

export const placeSearchResultSchema = z.object({
  name: z.string().describe('Place name'),
  place_id: z.string().describe('Google Maps internal place identifier (hex format)'),
  address: z.string().describe('Place address'),
  rating: z.number().describe('Average rating (1-5), 0 if not available'),
  review_count: z.number().describe('Number of reviews, 0 if not available'),
  type: z.string().describe('Place type/category (e.g., restaurant, cafe)'),
  lat: z.number().describe('Place latitude'),
  lng: z.number().describe('Place longitude'),
  open_now: z.string().describe('Current open status (e.g., "Open", "Closed", ""), empty if unknown'),
  price_level: z.string().describe('Price level ("$", "$$", "$$$", "$$$$"), empty if not available'),
});

export interface RawPlaceSearchResult {
  name?: string;
  place_id?: string;
  address?: string;
  rating?: number;
  review_count?: number;
  type?: string;
  lat?: number;
  lng?: number;
  open_now?: string;
  price_level?: string;
}

export const mapPlaceSearchResult = (p: RawPlaceSearchResult) => ({
  name: p.name ?? '',
  place_id: p.place_id ?? '',
  address: p.address ?? '',
  rating: p.rating ?? 0,
  review_count: p.review_count ?? 0,
  type: p.type ?? '',
  lat: p.lat ?? 0,
  lng: p.lng ?? 0,
  open_now: p.open_now ?? '',
  price_level: p.price_level ?? '',
});

// --- Place detail schema ---

export const placeDetailSchema = z.object({
  name: z.string().describe('Place name'),
  place_id: z.string().describe('Google Maps internal place identifier'),
  address: z.string().describe('Full address'),
  lat: z.number().describe('Place latitude'),
  lng: z.number().describe('Place longitude'),
  rating: z.number().describe('Average rating (1-5), 0 if not available'),
  review_count: z.number().describe('Number of reviews, 0 if not available'),
  phone: z.string().describe('Phone number, empty if not available'),
  website: z.string().describe('Website URL, empty if not available'),
  type: z.string().describe('Place type/category'),
  price_level: z.string().describe('Price level indicator'),
  hours: z.array(z.string()).describe('Opening hours by day, empty if not available'),
  url: z.string().describe('Google Maps URL for this place'),
});

export interface RawPlaceDetail {
  name?: string;
  place_id?: string;
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  review_count?: number;
  phone?: string;
  website?: string;
  type?: string;
  price_level?: string;
  hours?: string[];
  url?: string;
}

export const mapPlaceDetail = (p: RawPlaceDetail) => ({
  name: p.name ?? '',
  place_id: p.place_id ?? '',
  address: p.address ?? '',
  lat: p.lat ?? 0,
  lng: p.lng ?? 0,
  rating: p.rating ?? 0,
  review_count: p.review_count ?? 0,
  phone: p.phone ?? '',
  website: p.website ?? '',
  type: p.type ?? '',
  price_level: p.price_level ?? '',
  hours: p.hours ?? [],
  url: p.url ?? '',
});

// --- Directions schema ---

export const directionRouteSchema = z.object({
  summary: z.string().describe('Route summary (e.g., "via I-280 S")'),
  distance: z.string().describe('Total distance (e.g., "12.3 mi")'),
  duration: z.string().describe('Estimated travel time (e.g., "18 min")'),
  origin: z.string().describe('Origin address or name'),
  destination: z.string().describe('Destination address or name'),
  travel_mode: z.string().describe('Travel mode: driving, transit, walking, or bicycling'),
  url: z.string().describe('Google Maps directions URL'),
});

export interface RawDirectionRoute {
  summary?: string;
  distance?: string;
  duration?: string;
  origin?: string;
  destination?: string;
  travel_mode?: string;
  url?: string;
}

export const mapDirectionRoute = (r: RawDirectionRoute) => ({
  summary: r.summary ?? '',
  distance: r.distance ?? '',
  duration: r.duration ?? '',
  origin: r.origin ?? '',
  destination: r.destination ?? '',
  travel_mode: r.travel_mode ?? 'driving',
  url: r.url ?? '',
});
