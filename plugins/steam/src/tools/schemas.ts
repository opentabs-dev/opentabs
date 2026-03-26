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

// --- Price ---

export const priceSchema = z.object({
  currency: z.string().describe('Currency code (e.g., "USD")'),
  initial: z.number().describe('Initial price in cents'),
  final: z.number().describe('Final price in cents (after discount)'),
  discount_percent: z.number().describe('Discount percentage (0 if none)'),
  initial_formatted: z.string().describe('Formatted initial price string'),
  final_formatted: z.string().describe('Formatted final price string'),
});

export interface RawPrice {
  currency?: string;
  initial?: number;
  final?: number;
  discount_percent?: number;
  initial_formatted?: string;
  final_formatted?: string;
}

export const mapPrice = (p: RawPrice) => ({
  currency: p.currency ?? '',
  initial: p.initial ?? 0,
  final: p.final ?? 0,
  discount_percent: p.discount_percent ?? 0,
  initial_formatted: p.initial_formatted ?? '',
  final_formatted: p.final_formatted ?? '',
});

// --- Search Result ---

export const searchResultSchema = z.object({
  id: z.number().describe('App ID'),
  name: z.string().describe('App name'),
  type: z.string().describe('Item type (app, bundle, etc.)'),
  tiny_image: z.string().describe('Small capsule image URL'),
  price: priceSchema.optional().describe('Price info (absent for free games)'),
});

export interface RawSearchResult {
  id?: number;
  name?: string;
  type?: string;
  tiny_image?: string;
  price?: RawPrice;
}

export const mapSearchResult = (r: RawSearchResult) => ({
  id: r.id ?? 0,
  name: r.name ?? '',
  type: r.type ?? '',
  tiny_image: r.tiny_image ?? '',
  ...(r.price ? { price: mapPrice(r.price) } : {}),
});

// --- App Details ---

export const platformsSchema = z.object({
  windows: z.boolean().describe('Available on Windows'),
  mac: z.boolean().describe('Available on macOS'),
  linux: z.boolean().describe('Available on Linux'),
});

export const categorySchema = z.object({
  id: z.number().describe('Category ID'),
  description: z.string().describe('Category name'),
});

export const genreSchema = z.object({
  id: z.string().describe('Genre ID'),
  description: z.string().describe('Genre name'),
});

export const metacriticSchema = z.object({
  score: z.number().describe('Metacritic score'),
  url: z.string().describe('Metacritic URL'),
});

export const releaseDateSchema = z.object({
  coming_soon: z.boolean().describe('Whether the game is unreleased'),
  date: z.string().describe('Release date string'),
});

export const appDetailsSchema = z.object({
  steam_appid: z.number().describe('Steam app ID'),
  type: z.string().describe('Type (game, dlc, demo, etc.)'),
  name: z.string().describe('App name'),
  is_free: z.boolean().describe('Whether the app is free'),
  short_description: z.string().describe('Short description'),
  header_image: z.string().describe('Header image URL'),
  website: z.string().describe('Official website URL'),
  developers: z.array(z.string()).describe('Developer names'),
  publishers: z.array(z.string()).describe('Publisher names'),
  platforms: platformsSchema.describe('Platform availability'),
  categories: z.array(categorySchema).describe('Store categories'),
  genres: z.array(genreSchema).describe('Genres'),
  release_date: releaseDateSchema.describe('Release date info'),
  metacritic: metacriticSchema.optional().describe('Metacritic score (if available)'),
  price_overview: priceSchema.optional().describe('Price info (absent for free games)'),
  recommendations: z
    .object({ total: z.number().describe('Total recommendation count') })
    .optional()
    .describe('Recommendation count'),
  supported_languages: z.string().describe('Supported languages (HTML string)'),
  required_age: z.number().describe('Minimum age requirement (0 if none)'),
});

export interface RawAppDetails {
  steam_appid?: number;
  type?: string;
  name?: string;
  is_free?: boolean;
  short_description?: string;
  header_image?: string;
  website?: string | null;
  developers?: string[];
  publishers?: string[];
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  categories?: { id?: number; description?: string }[];
  genres?: { id?: string; description?: string }[];
  release_date?: { coming_soon?: boolean; date?: string };
  metacritic?: { score?: number; url?: string };
  price_overview?: RawPrice;
  recommendations?: { total?: number };
  supported_languages?: string;
  required_age?: number | string;
}

export const mapAppDetails = (d: RawAppDetails) => ({
  steam_appid: d.steam_appid ?? 0,
  type: d.type ?? '',
  name: d.name ?? '',
  is_free: d.is_free ?? false,
  short_description: d.short_description ?? '',
  header_image: d.header_image ?? '',
  website: d.website ?? '',
  developers: d.developers ?? [],
  publishers: d.publishers ?? [],
  platforms: {
    windows: d.platforms?.windows ?? false,
    mac: d.platforms?.mac ?? false,
    linux: d.platforms?.linux ?? false,
  },
  categories: (d.categories ?? []).map(c => ({
    id: c.id ?? 0,
    description: c.description ?? '',
  })),
  genres: (d.genres ?? []).map(g => ({
    id: g.id ?? '',
    description: g.description ?? '',
  })),
  release_date: {
    coming_soon: d.release_date?.coming_soon ?? false,
    date: d.release_date?.date ?? '',
  },
  ...(d.metacritic ? { metacritic: { score: d.metacritic.score ?? 0, url: d.metacritic.url ?? '' } } : {}),
  ...(d.price_overview ? { price_overview: mapPrice(d.price_overview) } : {}),
  ...(d.recommendations ? { recommendations: { total: d.recommendations.total ?? 0 } } : {}),
  supported_languages: stripHtmlTags(d.supported_languages ?? ''),
  required_age: typeof d.required_age === 'string' ? Number(d.required_age) || 0 : (d.required_age ?? 0),
});

// --- Featured Game ---

export const featuredGameSchema = z.object({
  id: z.number().describe('App ID'),
  name: z.string().describe('App name'),
  discounted: z.boolean().describe('Whether the game is currently discounted'),
  discount_percent: z.number().describe('Discount percentage'),
  original_price: z.number().describe('Original price in cents (0 for free games)'),
  final_price: z.number().describe('Final price in cents (0 for free games)'),
  currency: z.string().describe('Currency code'),
  header_image: z.string().describe('Header image URL'),
});

export interface RawFeaturedGame {
  id?: number;
  name?: string;
  discounted?: boolean;
  discount_percent?: number;
  original_price?: number;
  final_price?: number;
  currency?: string;
  header_image?: string;
}

export const mapFeaturedGame = (g: RawFeaturedGame) => ({
  id: g.id ?? 0,
  name: g.name ?? '',
  discounted: g.discounted ?? false,
  discount_percent: g.discount_percent ?? 0,
  original_price: g.original_price ?? 0,
  final_price: g.final_price ?? 0,
  currency: g.currency ?? '',
  header_image: g.header_image ?? '',
});

// --- Review ---

export const reviewSchema = z.object({
  recommendationid: z.string().describe('Review ID'),
  author_steamid: z.string().describe('Author Steam ID'),
  author_playtime_forever: z.number().describe('Author total playtime in minutes'),
  language: z.string().describe('Review language'),
  review: z.string().describe('Review text'),
  voted_up: z.boolean().describe('Whether the review is positive'),
  votes_up: z.number().describe('Helpful votes'),
  votes_funny: z.number().describe('Funny votes'),
  timestamp_created: z.number().describe('Unix timestamp of creation'),
  steam_purchase: z.boolean().describe('Whether the reviewer bought on Steam'),
});

export interface RawReview {
  recommendationid?: string;
  author?: {
    steamid?: string;
    playtime_forever?: number;
  };
  language?: string;
  review?: string;
  voted_up?: boolean;
  votes_up?: number;
  votes_funny?: number;
  timestamp_created?: number;
  steam_purchase?: boolean;
}

export const mapReview = (r: RawReview) => ({
  recommendationid: r.recommendationid ?? '',
  author_steamid: r.author?.steamid ?? '',
  author_playtime_forever: r.author?.playtime_forever ?? 0,
  language: r.language ?? '',
  review: r.review ?? '',
  voted_up: r.voted_up ?? false,
  votes_up: r.votes_up ?? 0,
  votes_funny: r.votes_funny ?? 0,
  timestamp_created: r.timestamp_created ?? 0,
  steam_purchase: r.steam_purchase ?? false,
});

// --- Review Summary ---

export const reviewSummarySchema = z.object({
  total_reviews: z.number().describe('Total number of reviews'),
  total_positive: z.number().describe('Total positive reviews'),
  total_negative: z.number().describe('Total negative reviews'),
  review_score_desc: z.string().describe('Review score label (e.g., "Very Positive")'),
});

// --- Tag ---

export const tagSchema = z.object({
  tagid: z.number().describe('Tag ID'),
  name: z.string().describe('Tag name'),
});

export interface RawTag {
  tagid?: number;
  name?: string;
}

export const mapTag = (t: RawTag) => ({
  tagid: t.tagid ?? 0,
  name: t.name ?? '',
});

// --- User Data ---

export const userDataSchema = z.object({
  wishlist: z.array(z.number()).describe('App IDs in wishlist'),
  owned_apps: z.array(z.number()).describe('Owned app IDs'),
  owned_packages: z.array(z.number()).describe('Owned package IDs'),
  followed_apps: z.array(z.number()).describe('Followed app IDs'),
  ignored_apps: z.array(z.number()).describe('Ignored app IDs'),
  recommended_tags: z.array(tagSchema).describe('Recommended tags based on library'),
  cart_line_item_count: z.number().describe('Number of items in cart'),
});

// --- App User Details ---

export const friendPlaytimeSchema = z.object({
  steamid: z.string().describe('Friend Steam ID'),
  playtime_total: z.number().describe('Total playtime in minutes'),
  playtime_twoweeks: z.number().describe('Playtime in last two weeks in minutes'),
});

export interface RawFriendPlaytime {
  steamid?: string;
  playtime_total?: number;
  playtime_twoweeks?: number;
}

export const mapFriendPlaytime = (f: RawFriendPlaytime) => ({
  steamid: f.steamid ?? '',
  playtime_total: f.playtime_total ?? 0,
  playtime_twoweeks: f.playtime_twoweeks ?? 0,
});

export const appUserDetailsSchema = z.object({
  is_owned: z.boolean().describe('Whether the user owns this app'),
  added_to_wishlist: z.boolean().describe('Whether the app is on the wishlist'),
  friends_own: z.array(friendPlaytimeSchema).describe('Friends who own this app'),
});
