import { z } from 'zod';

// --- Title (Movie or Show) ---

export const titleSchema = z.object({
  video_id: z.number().int().describe('Netflix video ID'),
  title: z.string().describe('Title name'),
  type: z.string().describe('Content type: movie, show, or supplemental'),
  year: z.number().int().describe('Release year or latest year'),
  is_original: z.boolean().describe('Whether this is a Netflix Original'),
  maturity_rating: z.string().describe('Maturity rating (e.g., TV-MA, PG-13)'),
  maturity_description: z.string().describe('Description of the maturity rating'),
  synopsis: z.string().describe('Content synopsis or description'),
  genres: z.string().describe('Comma-separated genre tags'),
  watch_status: z.string().describe('Watch status: NOT_WATCHED, STARTED, or WATCHED'),
  is_in_my_list: z.boolean().describe('Whether the title is in the user My List'),
  runtime_minutes: z.number().describe('Runtime in minutes (for movies) or 0 for shows'),
  num_seasons: z.string().describe('Number of seasons label (for shows) or empty'),
  image_url: z.string().describe('Thumbnail image URL'),
});

export interface RawTitle {
  videoId?: number;
  title?: string;
  __typename?: string;
  latestYear?: number;
  isOriginal?: boolean;
  contentAdvisory?: {
    certificationValue?: string;
    maturityDescription?: string;
  };
  synopsis?: { value?: string };
  contextualSynopsis?: { text?: string };
  textEvidence?: Array<{ text?: string }>;
  watchStatus?: string;
  isInPlaylist?: boolean;
  isInRemindMeList?: boolean;
  runtimeSec?: number;
  displayRuntimeSec?: number;
  numSeasonsLabel?: string;
  artwork?: { url?: string };
  artworkUrl?: string;
  summary?: { type?: string; isOriginal?: boolean };
}

export const mapTitle = (t: RawTitle): z.infer<typeof titleSchema> => ({
  video_id: t.videoId ?? 0,
  title: t.title ?? '',
  type: t.__typename?.toLowerCase() ?? t.summary?.type ?? '',
  year: t.latestYear ?? 0,
  is_original: t.isOriginal ?? t.summary?.isOriginal ?? false,
  maturity_rating: t.contentAdvisory?.certificationValue ?? '',
  maturity_description: t.contentAdvisory?.maturityDescription ?? '',
  synopsis: t.contextualSynopsis?.text ?? t.synopsis?.value ?? '',
  genres: t.textEvidence?.[0]?.text ?? '',
  watch_status: t.watchStatus ?? 'NOT_WATCHED',
  is_in_my_list: t.isInPlaylist ?? t.isInRemindMeList ?? false,
  runtime_minutes: Math.round((t.displayRuntimeSec ?? t.runtimeSec ?? 0) / 60),
  num_seasons: t.numSeasonsLabel ?? '',
  image_url: t.artwork?.url ?? t.artworkUrl ?? '',
});

// --- Episode ---

export const episodeSchema = z.object({
  video_id: z.number().int().describe('Episode video ID'),
  title: z.string().describe('Episode title'),
  episode_number: z.number().int().describe('Episode number within the season'),
  season_number: z.number().int().describe('Season number'),
  synopsis: z.string().describe('Episode synopsis'),
  runtime_minutes: z.number().describe('Runtime in minutes'),
  watch_status: z.string().describe('Watch status: NOT_WATCHED, STARTED, or WATCHED'),
  bookmark_position_seconds: z.number().describe('Bookmark position in seconds (0 if not started)'),
  image_url: z.string().describe('Episode thumbnail URL'),
});

export interface RawEpisode {
  videoId?: number;
  title?: string;
  number?: number;
  seasonNumber?: number;
  synopsis?: { value?: string };
  contextualSynopsis?: { text?: string };
  runtimeSec?: number;
  displayRuntimeSec?: number;
  watchStatus?: string;
  bookmark?: { position?: number };
  artwork?: { url?: string };
  artworkUrl?: string;
}

export const mapEpisode = (e: RawEpisode, seasonNum?: number): z.infer<typeof episodeSchema> => ({
  video_id: e.videoId ?? 0,
  title: e.title ?? '',
  episode_number: e.number ?? 0,
  season_number: seasonNum ?? e.seasonNumber ?? 0,
  synopsis: e.contextualSynopsis?.text ?? e.synopsis?.value ?? '',
  runtime_minutes: Math.round((e.displayRuntimeSec ?? e.runtimeSec ?? 0) / 60),
  watch_status: e.watchStatus ?? 'NOT_WATCHED',
  bookmark_position_seconds: e.bookmark?.position ?? 0,
  image_url: e.artwork?.url ?? e.artworkUrl ?? '',
});

// --- Season ---

export const seasonSchema = z.object({
  video_id: z.number().int().describe('Season video ID'),
  season_number: z.number().int().describe('Season number'),
  title: z.string().describe('Season title (e.g., "Season 1")'),
  episode_count: z.number().int().describe('Number of episodes in the season'),
});

export interface RawSeason {
  videoId?: number;
  seasonNumber?: number;
  title?: string;
  episodes?: { totalCount?: number };
  episodeCount?: number;
}

export const mapSeason = (s: RawSeason): z.infer<typeof seasonSchema> => ({
  video_id: s.videoId ?? 0,
  season_number: s.seasonNumber ?? 0,
  title: s.title ?? '',
  episode_count: s.episodes?.totalCount ?? s.episodeCount ?? 0,
});

// --- Profile ---

export const profileSchema = z.object({
  guid: z.string().describe('Profile GUID'),
  name: z.string().describe('Profile display name'),
  is_kids: z.boolean().describe('Whether this is a kids profile'),
  avatar_url: z.string().describe('Avatar image URL'),
  is_active: z.boolean().describe('Whether this is the currently active profile'),
});

export interface RawProfile {
  guid?: string;
  profileName?: string;
  firstName?: string;
  isKids?: boolean;
  avatar?: { url?: string; images?: Record<string, { url?: string }> };
  avatarUrl?: string;
  isActive?: boolean;
  isCurrent?: boolean;
}

export const mapProfile = (p: RawProfile): z.infer<typeof profileSchema> => ({
  guid: p.guid ?? '',
  name: p.profileName ?? p.firstName ?? '',
  is_kids: p.isKids ?? false,
  avatar_url: p.avatar?.url ?? p.avatarUrl ?? '',
  is_active: p.isActive ?? p.isCurrent ?? false,
});

// --- User Info ---

export const userInfoSchema = z.object({
  guid: z.string().describe('User GUID'),
  name: z.string().describe('Account owner name'),
  email: z.string().describe('Account email (if available)'),
  member_since: z.string().describe('Membership start date (e.g., "January 2025")'),
  membership_status: z.string().describe('Membership status (e.g., CURRENT_MEMBER)'),
  country: z.string().describe('Current country code'),
  num_profiles: z.number().int().describe('Total number of profiles on the account'),
  maturity_level: z.number().int().describe('Content maturity level for this profile'),
  can_playback: z.boolean().describe('Whether playback is allowed'),
});

export interface RawUserInfo {
  guid?: string;
  userGuid?: string;
  name?: string;
  accountOwnerName?: string;
  email?: string;
  memberSince?: string;
  membershipStatus?: string;
  currentCountry?: string;
  numProfiles?: number;
  maturity?: number;
  pacsFeatures?: {
    featureResponses?: Array<{
      featureName?: string;
      responseClassification?: string;
    }>;
  };
}

export const mapUserInfo = (u: RawUserInfo): z.infer<typeof userInfoSchema> => {
  const canPlayback =
    u.pacsFeatures?.featureResponses?.find(f => f.featureName === 'CAN_PLAYBACK')?.responseClassification === 'ALLOWED';
  return {
    guid: u.guid ?? u.userGuid ?? '',
    name: u.accountOwnerName ?? u.name ?? '',
    email: u.email ?? '',
    member_since: u.memberSince ?? '',
    membership_status: u.membershipStatus ?? '',
    country: u.currentCountry ?? '',
    num_profiles: u.numProfiles ?? 0,
    maturity_level: u.maturity ?? 0,
    can_playback: canPlayback ?? false,
  };
};

// --- Apollo Cache Helper ---

/** Map an Apollo cache entry to the RawTitle shape for mapTitle. */
export const apolloEntryToRawTitle = (entry: Record<string, unknown>): RawTitle => {
  let artworkUrl = '';
  let genres = '';

  for (const [k, v] of Object.entries(entry)) {
    if (!artworkUrl && (k.startsWith('artwork(') || k.startsWith('artworkExtended('))) {
      const art = v as Record<string, unknown> | undefined;
      if (art?.url && typeof art.url === 'string') artworkUrl = art.url;
    }
    if (!genres && k.startsWith('textEvidence(')) {
      const tags = v as Array<{ text?: string }> | undefined;
      if (tags?.[0]?.text) genres = tags[0].text;
    }
  }

  return {
    videoId: entry.videoId as number | undefined,
    title: entry.title as string | undefined,
    __typename: entry.__typename as string | undefined,
    latestYear: entry.latestYear as number | undefined,
    watchStatus: entry.watchStatus as string | undefined,
    isInPlaylist: entry.isInPlaylist as boolean | undefined,
    isInRemindMeList: entry.isInRemindMeList as boolean | undefined,
    runtimeSec: (entry.displayRuntimeSec ?? entry.runtimeSec) as number | undefined,
    numSeasonsLabel: entry.numSeasonsLabel as string | undefined,
    contentAdvisory: entry.contentAdvisory as RawTitle['contentAdvisory'],
    artworkUrl,
    textEvidence: genres ? [{ text: genres }] : undefined,
  };
};

// --- Watch History Entry ---

export const watchHistorySchema = z.object({
  video_id: z.number().int().describe('Netflix video ID'),
  title: z.string().describe('Title name'),
  type: z.string().describe('Content type: movie or show'),
  watch_status: z.string().describe('Watch status: STARTED or WATCHED'),
  bookmark_position_seconds: z.number().describe('Bookmark position in seconds'),
  runtime_seconds: z.number().describe('Total runtime in seconds'),
  last_watched: z.string().describe('ISO 8601 timestamp of last watch (if available)'),
});

export interface RawWatchHistoryEntry {
  videoId?: number;
  title?: string;
  type?: string;
  __typename?: string;
  watchStatus?: string;
  bookmark?: { position?: number };
  bookmarkPosition?: number;
  runtimeSec?: number;
  runtime?: number;
  dateStr?: string;
  summary?: { type?: string };
}

export const mapWatchHistoryEntry = (e: RawWatchHistoryEntry): z.infer<typeof watchHistorySchema> => ({
  video_id: e.videoId ?? 0,
  title: e.title ?? '',
  type: e.__typename?.toLowerCase() ?? e.summary?.type ?? e.type ?? '',
  watch_status: e.watchStatus ?? 'STARTED',
  bookmark_position_seconds: e.bookmark?.position ?? e.bookmarkPosition ?? 0,
  runtime_seconds: e.runtimeSec ?? e.runtime ?? 0,
  last_watched: e.dateStr ?? '',
});
