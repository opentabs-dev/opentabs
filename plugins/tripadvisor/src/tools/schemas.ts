import { z } from 'zod';

const stripHtmlTags = (html: string): string => {
  let result = html;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]+>/g, '');
  } while (result !== prev);
  return result;
};

// --- Location / Place ---

export const locationSchema = z.object({
  location_id: z.number().int().describe('TripAdvisor location ID'),
  name: z.string().describe('Location name'),
  type: z.string().describe('Location type (e.g., EATERY, HOTEL, ATTRACTION, GEO)'),
  url: z.string().describe('TripAdvisor URL path'),
  address: z.string().describe('Full street address'),
  city: z.string().describe('City name'),
  state: z.string().describe('State or region'),
  country: z.string().describe('Country name'),
  postal_code: z.string().describe('Postal/ZIP code'),
  latitude: z.number().describe('Latitude coordinate'),
  longitude: z.number().describe('Longitude coordinate'),
  phone: z.string().describe('Phone number'),
  rating: z.number().describe('Average rating (0-5)'),
  review_count: z.number().int().describe('Total number of reviews'),
  price_range: z.string().describe('Price range (e.g., "$$ - $$$")'),
  cuisine: z.array(z.string()).describe('Cuisine types'),
  image_url: z.string().describe('Primary photo URL'),
  ranking: z.string().describe('Ranking text (e.g., "#1 of 500 Restaurants")'),
});

export interface RawLocation {
  locationId?: number;
  location_id?: number;
  name?: string;
  localizedName?: string;
  placeType?: string;
  type?: string;
  url?: string;
  route?: { url?: string; webLinkUrl?: string };
  detailPageRoute?: { webLinkUrl?: string };
  address?: Record<string, unknown>;
  addressObj?: {
    street1?: string;
    city?: string;
    state?: string;
    country?: string;
    postalcode?: string;
  };
  geo?: { latitude?: number; longitude?: number };
  latitude?: number | string;
  longitude?: number | string;
  phone?: string;
  telephone?: string;
  aggregateRating?: { ratingValue?: number; reviewCount?: number };
  rating?: number;
  reviewCount?: number;
  averageRating?: number;
  numReviews?: number;
  priceRange?: string;
  priceLevel?: string;
  servesCuisine?: string[];
  cuisine?: Array<{ name?: string } | string>;
  image?: string;
  imageUrl?: string;
  photo?: { photoSizeDynamic?: { urlTemplate?: string } };
  thumbnail?: Array<{ data?: { photoSizeDynamic?: { urlTemplate?: string } } }>;
  rankingString?: string;
  ranking?: string;
}

export const mapLocation = (l: RawLocation): z.infer<typeof locationSchema> => {
  const addr = l.address as Record<string, unknown> | undefined;
  const addrObj = l.addressObj;
  const street =
    (addr?.streetAddress as string | undefined) ?? (addr?.street1 as string | undefined) ?? addrObj?.street1 ?? '';
  const city = (addr?.addressLocality as string | undefined) ?? addrObj?.city ?? '';
  const state = (addr?.addressRegion as string | undefined) ?? addrObj?.state ?? '';
  const addrCountry = addr?.addressCountry;
  const country =
    (typeof addrCountry === 'object' && addrCountry !== null
      ? ((addrCountry as { name?: string }).name ?? '')
      : (addrCountry as string | undefined)) ??
    addrObj?.country ??
    '';
  const postalCode = (addr?.postalCode as string | undefined) ?? addrObj?.postalcode ?? '';

  const lat = l.geo?.latitude ?? (typeof l.latitude === 'number' ? l.latitude : 0);
  const lng = l.geo?.longitude ?? (typeof l.longitude === 'number' ? l.longitude : 0);

  const cuisineArr = (l.servesCuisine ?? l.cuisine ?? []).map(c => (typeof c === 'object' ? (c.name ?? '') : c));

  const imageUrl =
    l.image ??
    l.imageUrl ??
    l.photo?.photoSizeDynamic?.urlTemplate?.replace('{width}', '500').replace('{height}', '-1') ??
    l.thumbnail?.[0]?.data?.photoSizeDynamic?.urlTemplate?.replace('{width}', '500').replace('{height}', '-1') ??
    '';

  return {
    location_id: l.locationId ?? l.location_id ?? 0,
    name: l.name ?? l.localizedName ?? '',
    type: l.placeType ?? l.type ?? '',
    url: l.url ?? l.route?.url ?? l.route?.webLinkUrl ?? l.detailPageRoute?.webLinkUrl ?? '',
    address: [street, city, state, postalCode].filter(Boolean).join(', '),
    city,
    state,
    country,
    postal_code: postalCode,
    latitude: lat,
    longitude: lng,
    phone: l.phone ?? l.telephone ?? '',
    rating: l.aggregateRating?.ratingValue ?? l.rating ?? l.averageRating ?? 0,
    review_count: l.aggregateRating?.reviewCount ?? l.reviewCount ?? l.numReviews ?? 0,
    price_range: l.priceRange ?? l.priceLevel ?? '',
    cuisine: cuisineArr,
    image_url: imageUrl,
    ranking: l.rankingString ?? l.ranking ?? '',
  };
};

// --- Review ---

export const reviewSchema = z.object({
  id: z.number().int().describe('Review ID'),
  title: z.string().describe('Review title'),
  text: z.string().describe('Review text body'),
  rating: z.number().describe('Rating (1-5)'),
  author: z.string().describe('Reviewer display name'),
  author_location: z.string().describe('Reviewer location'),
  date: z.string().describe('Review date (e.g., "March 2026")'),
  trip_type: z.string().describe('Trip type (e.g., "Business", "Couples")'),
  url: z.string().describe('Review URL path'),
});

export interface RawReview {
  id?: number;
  title?: string;
  text?: string;
  htmlText?: { htmlContent?: string };
  rating?: number;
  userProfile?: {
    displayName?: string;
    hometown?: { locationName?: string };
  };
  author?: string;
  authorLocation?: string;
  publishedDate?: string;
  createdDate?: string;
  tripInfo?: { stayDate?: string; tripType?: string };
  tripType?: string;
  reviewDetailPageWrapper?: { reviewDetailPageRoute?: { url?: string } };
  url?: string;
}

export const mapReview = (r: RawReview): z.infer<typeof reviewSchema> => ({
  id: r.id ?? 0,
  title: r.title ?? '',
  text: r.text ?? stripHtmlTags(r.htmlText?.htmlContent ?? ''),
  rating: r.rating ?? 0,
  author: r.userProfile?.displayName ?? r.author ?? '',
  author_location: r.userProfile?.hometown?.locationName ?? r.authorLocation ?? '',
  date: r.publishedDate ?? r.createdDate ?? r.tripInfo?.stayDate ?? '',
  trip_type: r.tripInfo?.tripType ?? r.tripType ?? '',
  url: r.reviewDetailPageWrapper?.reviewDetailPageRoute?.url ?? r.url ?? '',
});

// --- Award ---

export const awardSchema = z.object({
  award_name: z.string().describe('Award identifier (e.g., "michelin_stars_1")'),
  award_title: z.string().describe('Award title (e.g., "MICHELIN")'),
  year: z.string().describe('Year of award'),
  description: z.string().describe('Award description'),
  summary: z.string().describe('Detailed review summary text'),
  external_url: z.string().describe('External URL for more details'),
});

export interface RawAward {
  awardHeader?: string;
  awardReadMore?: string;
  awards?: Array<{
    award_name?: string;
    award_title?: string;
    yearOfAward?: string;
    description?: string;
  }>;
  summaries?: Array<{
    text?: string;
    externalUrl?: string;
  }>;
}

export const mapAward = (a: RawAward): z.infer<typeof awardSchema>[] => {
  if (!a.awards?.length) return [];
  return a.awards.map((award, i) => ({
    award_name: award.award_name ?? '',
    award_title: award.award_title ?? '',
    year: award.yearOfAward ?? '',
    description: award.description ?? '',
    summary: a.summaries?.[i]?.text ?? '',
    external_url: a.summaries?.[i]?.externalUrl ?? '',
  }));
};

// --- User Profile ---

export const userProfileSchema = z.object({
  user_id: z.string().describe('TripAdvisor user ID'),
  display_name: z.string().describe('Display name'),
  avatar_url: z.string().describe('Avatar image URL'),
  profile_url: z.string().describe('Profile page URL path'),
  has_unread_messages: z.boolean().describe('Whether user has unread inbox messages'),
});

export interface RawMemberProfile {
  displayName?: string;
  avatar?: { photoSizeDynamic?: { urlTemplate?: string } };
  route?: { url?: string };
}

export const mapUserProfile = (
  m: RawMemberProfile,
  userId: string,
  hasUnread: boolean,
): z.infer<typeof userProfileSchema> => ({
  user_id: userId,
  display_name: m.displayName ?? '',
  avatar_url: m.avatar?.photoSizeDynamic?.urlTemplate?.replace('{width}', '100').replace('{height}', '100') ?? '',
  profile_url: m.route?.url ?? '',
  has_unread_messages: hasUnread,
});

// --- Restaurant Subratings ---

export const subratingsSchema = z.object({
  food: z.number().describe('Food rating (0-5)'),
  service: z.number().describe('Service rating (0-5)'),
  value: z.number().describe('Value rating (0-5)'),
  atmosphere: z.number().describe('Atmosphere rating (0-5)'),
});

export interface RawSubratings {
  food?: number;
  service?: number;
  value?: number;
  atmosphere?: number;
}

export const mapSubratings = (s: RawSubratings): z.infer<typeof subratingsSchema> => ({
  food: s.food ?? 0,
  service: s.service ?? 0,
  value: s.value ?? 0,
  atmosphere: s.atmosphere ?? 0,
});

// --- AI Review Summary ---

export const aiSummarySchema = z.object({
  summary: z.string().describe('AI-generated review summary text'),
  location_id: z.number().int().describe('Location ID'),
});

export interface RawAiSummary {
  responseData?: {
    locationId?: number;
    aiData?: {
      overallSummary?: {
        summaryText?: string;
      };
    };
  };
}

export const mapAiSummary = (s: RawAiSummary): z.infer<typeof aiSummarySchema> => ({
  summary: s.responseData?.aiData?.overallSummary?.summaryText ?? '',
  location_id: s.responseData?.locationId ?? 0,
});

// --- Search Result ---

export const searchResultSchema = z.object({
  location_id: z.number().int().describe('TripAdvisor location ID'),
  name: z.string().describe('Location name'),
  type: z.string().describe('Result type (e.g., "EATERY", "HOTEL", "GEO")'),
  url: z.string().describe('TripAdvisor URL path'),
  image_url: z.string().describe('Thumbnail image URL'),
  rating: z.number().describe('Average rating (0-5)'),
  review_count: z.number().int().describe('Total number of reviews'),
});

export interface RawSearchResult {
  detailId?: number;
  locationId?: number;
  name?: string;
  displayName?: string;
  placeType?: string;
  resultType?: string;
  url?: string;
  route?: { url?: string; webLinkUrl?: string };
  imageUrl?: string;
  photo?: { photoSizeDynamic?: { urlTemplate?: string } };
  rating?: number;
  averageRating?: number;
  reviewCount?: number;
  numReviews?: number;
}

export const mapSearchResult = (r: RawSearchResult): z.infer<typeof searchResultSchema> => ({
  location_id: r.detailId ?? r.locationId ?? 0,
  name: r.name ?? r.displayName ?? '',
  type: r.placeType ?? r.resultType ?? '',
  url: r.url ?? r.route?.url ?? r.route?.webLinkUrl ?? '',
  image_url:
    r.imageUrl ?? r.photo?.photoSizeDynamic?.urlTemplate?.replace('{width}', '250').replace('{height}', '-1') ?? '',
  rating: r.rating ?? r.averageRating ?? 0,
  review_count: r.reviewCount ?? r.numReviews ?? 0,
});

// --- Neighborhood ---

export const neighborhoodSchema = z.object({
  name: z.string().describe('Neighborhood name'),
  description: z.string().describe('Neighborhood description'),
});

export interface RawNeighborhood {
  name?: string;
  locationInformation?: { localizedLocationDescription?: string };
}

export const mapNeighborhood = (n: RawNeighborhood): z.infer<typeof neighborhoodSchema> => ({
  name: n.name ?? '',
  description: n.locationInformation?.localizedLocationDescription ?? '',
});
