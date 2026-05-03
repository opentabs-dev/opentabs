import type { RedditListing } from '../reddit-api.js';
import { redditGet } from '../reddit-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface RedditPost {
  id: string;
  name: string;
  title: string;
  author: string;
  subreddit: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  url: string;
  permalink: string;
  selftext: string;
  is_self: boolean;
  created_utc: number;
  over_18: boolean;
  stickied: boolean;
  link_flair_text: string | null;
  thumbnail: string;
}

const postSchema = z.object({
  id: z.string().describe('Post ID (without t3_ prefix)'),
  name: z.string().describe('Post fullname (e.g., "t3_abc123")'),
  title: z.string().describe('Post title'),
  author: z.string().describe('Author username'),
  subreddit: z.string().describe('Subreddit name'),
  score: z.number().describe('Net score (upvotes minus downvotes)'),
  upvote_ratio: z.number().describe('Ratio of upvotes to total votes (0.0 to 1.0)'),
  num_comments: z.number().describe('Number of comments'),
  url: z
    .string()
    .nullable()
    .describe('URL the post links to (or the post URL for self posts) — null when include_body is false'),
  permalink: z.string().describe('Permalink path to the post on Reddit'),
  selftext: z
    .string()
    .nullable()
    .describe('Self post body text (empty for link posts) — null when include_body is false'),
  is_self: z.boolean().describe('Whether this is a self/text post'),
  created_utc: z.number().describe('Post creation time as Unix timestamp'),
  link_flair_text: z.string().nullable().describe('Link flair text if set'),
});

export const listPosts = defineTool({
  name: 'list_posts',
  displayName: 'List Posts',
  description:
    'List posts from a subreddit or the front page. Supports sorting by hot, new, top, rising, and controversial. Use the "after" cursor for pagination.',
  summary: 'List posts from a subreddit',
  icon: 'list',
  group: 'Posts',
  input: z.object({
    subreddit: z
      .string()
      .optional()
      .describe('Subreddit name without r/ prefix. Omit to get the front page / home feed.'),
    sort: z.enum(['hot', 'new', 'top', 'rising', 'controversial']).optional().describe('Sort order (default "hot")'),
    t: z
      .enum(['hour', 'day', 'week', 'month', 'year', 'all'])
      .optional()
      .describe('Time period for "top" and "controversial" sort (default "day")'),
    limit: z.number().int().min(1).max(100).optional().describe('Number of posts to return (default 25, max 100)'),
    after: z.string().optional().describe('Pagination cursor — fullname of the last item (e.g., "t3_abc123")'),
    include_body: z
      .boolean()
      .optional()
      .describe(
        'Whether to include post body text (selftext) and external URL. Defaults to false — titles and metadata only. Set true when you need to read post contents (doubles-to-triples the response size).',
      ),
  }),
  output: z.object({
    posts: z.array(postSchema).describe('Array of posts'),
    after: z.string().nullable().describe('Pagination cursor for the next page, or null if no more results'),
  }),
  handle: async params => {
    const sub = params.subreddit ? `/r/${params.subreddit}` : '';
    const sort = params.sort ?? 'hot';
    const path = `${sub}/${sort}.json`;
    const includeBody = params.include_body ?? false;

    const queryParams: Record<string, string> = {
      limit: String(params.limit ?? 25),
    };
    if (params.t && (sort === 'top' || sort === 'controversial')) {
      queryParams.t = params.t;
    }
    if (params.after) {
      queryParams.after = params.after;
    }

    const data = await redditGet<RedditListing<RedditPost>>(path, queryParams);

    return {
      posts: data.data.children.map(child => ({
        id: child.data.id,
        name: child.data.name,
        title: child.data.title,
        author: child.data.author,
        subreddit: child.data.subreddit,
        score: child.data.score,
        upvote_ratio: child.data.upvote_ratio,
        num_comments: child.data.num_comments,
        url: includeBody ? child.data.url : null,
        permalink: child.data.permalink,
        selftext: includeBody ? (child.data.selftext ?? '') : null,
        is_self: child.data.is_self,
        created_utc: child.data.created_utc,
        link_flair_text: child.data.link_flair_text ?? null,
      })),
      after: data.data.after ?? null,
    };
  },
});
