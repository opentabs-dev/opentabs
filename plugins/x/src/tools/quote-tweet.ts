import { z } from 'zod';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { graphqlMutation, graphqlQuery } from '../x-api.js';
import { tweetSchema, mapTweet } from './schemas.js';
import type { RawTweetResult } from './schemas.js';

interface CreateTweetResponse {
  data?: {
    create_tweet?: {
      tweet_results?: {
        result?: RawTweetResult;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Resolve the quoted tweet's author handle. X's CreateTweet endpoint rejects an
 * `attachment_url` that lacks a username path segment (error 44 — "attachment_url
 * parameter is invalid"), so the redirect forms (/i/status/, /i/web/status/) do
 * not work. The accepted form is a full permalink: x.com/<screen_name>/status/<id>.
 */
const resolveAuthorScreenName = async (tweetId: string): Promise<string> => {
  const data = await graphqlQuery<{ data?: { tweetResult?: { result?: RawTweetResult } } }>('TweetResultByRestId', {
    tweetId,
    withCommunity: true,
    includePromotedContent: false,
    withVoice: false,
  });

  let raw = data.data?.tweetResult?.result;
  if (raw?.__typename === 'TweetWithVisibilityResults') {
    raw = (raw as unknown as { tweet?: RawTweetResult }).tweet;
  }
  const screenName = mapTweet(raw ?? {}).author_screen_name;
  if (!screenName) {
    throw ToolError.notFound(`Could not resolve the quoted tweet (id ${tweetId}) — it may be deleted or protected.`);
  }
  return screenName;
};

export const quoteTweet = defineTool({
  name: 'quote_tweet',
  displayName: 'Quote Tweet',
  description:
    'Post a quote tweet — a top-level post that embeds and comments on another tweet. ' +
    'Unlike a reply (which lives inside the original thread) or a plain retweet (which adds no commentary), ' +
    'a quote tweet appears on your own profile with your text plus the referenced tweet.',
  summary: 'Post a quote tweet',
  icon: 'quote',
  group: 'Tweets',
  input: z.object({
    quoted_tweet_id: z.string().min(1).describe('ID of the tweet to quote'),
    text: z.string().min(1).max(280).describe('Commentary text (max 280 characters)'),
  }),
  output: z.object({
    tweet: tweetSchema,
  }),
  handle: async params => {
    // X's web client posts a quote tweet via the standard CreateTweet mutation
    // with an attachment_url pointing at the quoted tweet. The URL must contain
    // the quoted author's handle, so resolve it first.
    const screenName = await resolveAuthorScreenName(params.quoted_tweet_id);

    const variables: Record<string, unknown> = {
      tweet_text: params.text,
      attachment_url: `https://x.com/${screenName}/status/${params.quoted_tweet_id}`,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    };

    const data = await graphqlMutation<CreateTweetResponse>('CreateTweet', variables);

    const createResult = data.data?.create_tweet;
    const tweetResult = createResult?.tweet_results?.result;
    if (!tweetResult) {
      const errors = data.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        throw ToolError.internal(errors.map(e => e.message).join('; '));
      }
      // X accepted the request but returned no tweet — ambiguous outcome.
      // Non-retryable to avoid a double-post; verify on the timeline first.
      if (createResult?.tweet_results !== undefined) {
        throw new ToolError(
          'CreateTweet returned an empty tweet_results object — X accepted the quote tweet but returned no result. ' +
            'The post may or may not have landed; verify on the timeline before retrying to avoid a double-post.',
          'EMPTY_RESULT_AMBIGUOUS',
          { category: 'internal', retryable: false },
        );
      }
      throw ToolError.internal(`CreateTweet returned unexpected response: ${JSON.stringify(data).slice(0, 500)}`);
    }

    return { tweet: mapTweet(tweetResult) };
  },
});
