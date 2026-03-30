import { getPageGlobal } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { readApolloTitle } from '../netflix-api.js';

const titleDetailsSchema = z.object({
  video_id: z.number().int().describe('Netflix video ID'),
  title: z.string().describe('Title name'),
  type: z.string().describe('Content type: movie, show, or supplemental'),
  year: z.number().int().describe('Release year'),
  synopsis: z.string().describe('Full synopsis'),
  maturity_rating: z.string().describe('Content rating (e.g., TV-MA, PG-13)'),
  maturity_description: z.string().describe('Description of the maturity rating'),
  content_reasons: z.array(z.string()).describe('Content advisory reasons (e.g., "violence", "language")'),
  genres: z.string().describe('Genre tags'),
  cast: z.array(z.string()).describe('Cast member names (may be empty — not always available from the cache)'),
  creators: z.array(z.string()).describe('Creator/director names (may be empty — not always available from the cache)'),
  is_original: z.boolean().describe('Whether this is a Netflix Original'),
  playback_badges: z.array(z.string()).describe('Quality badges (e.g., VIDEO_ULTRA_HD, AUDIO_FIVE_DOT_ONE)'),
  watch_status: z.string().describe('Watch status'),
  is_in_my_list: z.boolean().describe('Whether the title is in My List'),
  thumb_rating: z.string().describe('User thumb rating (THUMBS_UP, THUMBS_DOWN, THUMBS_WAY_UP, or THUMBS_UNRATED)'),
  runtime_minutes: z.number().describe('Runtime in minutes (for movies)'),
  num_seasons: z.string().describe('Number of seasons (for shows)'),
  image_url: z.string().describe('Title artwork URL'),
});

export const getTitleDetails = defineTool({
  name: 'get_title_details',
  displayName: 'Get Title Details',
  description:
    'Get comprehensive details about a Netflix title including content advisory, quality badges, and user rating. More detailed than get_title — use this when you need content advisories or playback badges.',
  summary: 'Get full details including advisories and badges',
  icon: 'info',
  group: 'Browse',
  input: z.object({
    video_id: z.number().int().describe('Netflix video ID'),
  }),
  output: z.object({ title: titleDetailsSchema }),
  handle: async params => {
    const videoId = String(params.video_id);

    // Try reading from Apollo cache first for rich data
    const apolloClient = getPageGlobal('netflix.appContext.state.graphqlClient') as {
      cache?: { extract: () => Record<string, Record<string, unknown>> };
    } | null;

    let apolloData: Record<string, unknown> | null = null;
    if (apolloClient?.cache) {
      const cacheData = apolloClient.cache.extract();
      apolloData = cacheData[`Movie:{"videoId":${videoId}}`] ?? cacheData[`Show:{"videoId":${videoId}}`] ?? null;
    }

    // Also read from Apollo cache by video ID
    if (!apolloData) {
      apolloData = readApolloTitle(params.video_id);
    }
    const titleVal = (apolloData?.title as string | undefined) ?? '';

    if (!apolloData && !titleVal) {
      // Fetch via pathEvaluator to populate the cache
      const pe = getPageGlobal('netflix.appContext.state.pathEvaluator') as {
        get?: (...args: unknown[]) => Promise<{ json?: Record<string, unknown> }>;
      } | null;

      if (pe?.get) {
        const paths = [
          ['videos', params.video_id, ['title', 'summary', 'queue', 'inRemindMeList', 'runtime', 'current']],
        ];

        await pe.get.bind(pe)(...paths);
      }

      // Re-read Apollo cache after pathEvaluator fetch
      if (apolloClient?.cache) {
        const cacheData = apolloClient.cache.extract();
        apolloData = cacheData[`Movie:{"videoId":${videoId}}`] ?? cacheData[`Show:{"videoId":${videoId}}`] ?? null;
      }
      if (!apolloData) apolloData = readApolloTitle(params.video_id);
    }

    // Build the response from available data sources
    const contentAdvisory = apolloData?.contentAdvisory as Record<string, unknown> | undefined;
    const reasons = (contentAdvisory?.reasons as Array<{ text?: string }> | undefined) ?? [];
    const playbackBadges = (apolloData?.playbackBadges as string[] | undefined) ?? [];

    // textEvidence keys (e.g., textEvidence({"field":"genres"})) contain genre tags
    let genres = '';
    if (apolloData) {
      for (const k of Object.keys(apolloData)) {
        if (k.startsWith('textEvidence(') || k.startsWith('textEvidence')) {
          const tags = apolloData[k] as Array<{ text?: string }> | undefined;
          if (tags?.[0]?.text) {
            genres = tags[0].text;
            break;
          }
        }
      }
    }

    // Synopsis comes from contextualSynopsis or synopsis fields
    const contextualSynopsis = apolloData?.contextualSynopsis as { text?: string } | undefined;
    const synopsisField = apolloData?.synopsis as { value?: string } | undefined;
    const synopsis = contextualSynopsis?.text ?? synopsisField?.value ?? '';

    return {
      title: {
        video_id: params.video_id,
        title: (apolloData?.title as string | undefined) ?? titleVal ?? '',
        type: (apolloData?.__typename as string | undefined)?.toLowerCase() ?? '',
        year: (apolloData?.latestYear as number | undefined) ?? 0,
        synopsis,
        maturity_rating: (contentAdvisory?.certificationValue as string | undefined) ?? '',
        maturity_description: (contentAdvisory?.maturityDescription as string | undefined) ?? '',
        content_reasons: reasons.map(r => r.text ?? '').filter(Boolean),
        genres,
        cast: [],
        creators: [],
        is_original: (apolloData?.isOriginal as boolean | undefined) ?? false,
        playback_badges: playbackBadges,
        watch_status: (apolloData?.watchStatus as string | undefined) ?? 'NOT_WATCHED',
        is_in_my_list: (apolloData?.isInPlaylist as boolean | undefined) ?? false,
        thumb_rating: (apolloData?.thumbRatingV2 as string | undefined) ?? 'THUMBS_UNRATED',
        runtime_minutes: Math.round(
          (((apolloData?.displayRuntimeSec ?? apolloData?.runtimeSec) as number | undefined) ?? 0) / 60,
        ),
        num_seasons: (apolloData?.numSeasonsLabel as string | undefined) ?? '',
        image_url: '',
      },
    };
  },
});
