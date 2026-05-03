import type { RedditListing } from '../reddit-api.js';
import { redditGet } from '../reddit-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface SearchResult {
  id: string;
  name: string;
  title: string;
  author: string;
  subreddit: string;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  selftext: string;
  is_self: boolean;
  created_utc: number;
}

export const searchPosts = defineTool({
  name: 'search_posts',
  displayName: 'Search Posts',
  description: 'Search for posts across Reddit or within a specific subreddit. Supports sorting and time filtering.',
  summary: 'Search Reddit posts',
  icon: 'search',
  group: 'Posts',
  input: z.object({
    query: z.string().min(1).describe('Search query string'),
    subreddit: z.string().optional().describe('Restrict search to this subreddit (without r/ prefix)'),
    sort: z
      .enum(['relevance', 'hot', 'top', 'new', 'comments'])
      .optional()
      .describe('Sort order (default "relevance")'),
    t: z
      .enum(['hour', 'day', 'week', 'month', 'year', 'all'])
      .optional()
      .describe('Time period filter (default "all")'),
    limit: z.number().int().min(1).max(100).optional().describe('Number of results (default 25, max 100)'),
    after: z.string().optional().describe('Pagination cursor for the next page'),
    include_body: z
      .boolean()
      .optional()
      .describe(
        'Whether to include post body text (selftext) and external URL. Defaults to false — titles and metadata only. Set true when you need to read post contents (doubles-to-triples the response size).',
      ),
  }),
  output: z.object({
    posts: z
      .array(
        z.object({
          id: z.string().describe('Post ID'),
          name: z.string().describe('Post fullname'),
          title: z.string().describe('Post title'),
          author: z.string().describe('Author username'),
          subreddit: z.string().describe('Subreddit name'),
          score: z.number().describe('Post score'),
          num_comments: z.number().describe('Number of comments'),
          url: z.string().nullable().describe('Post URL — null when include_body is false'),
          permalink: z.string().describe('Reddit permalink'),
          selftext: z.string().nullable().describe('Self post body — null when include_body is false'),
          is_self: z.boolean().describe('Whether this is a text post'),
          created_utc: z.number().describe('Creation timestamp'),
        }),
      )
      .describe('Search results'),
    after: z.string().nullable().describe('Pagination cursor for next page'),
  }),
  handle: async params => {
    const base = params.subreddit ? `/r/${params.subreddit}` : '';
    const includeBody = params.include_body ?? false;
    const queryParams: Record<string, string> = {
      q: params.query,
      limit: String(params.limit ?? 25),
      restrict_sr: params.subreddit ? 'true' : 'false',
    };
    if (params.sort) queryParams.sort = params.sort;
    if (params.t) queryParams.t = params.t;
    if (params.after) queryParams.after = params.after;

    const data = await redditGet<RedditListing<SearchResult>>(`${base}/search.json`, queryParams);

    return {
      posts: data.data.children.map(child => ({
        id: child.data.id,
        name: child.data.name,
        title: child.data.title,
        author: child.data.author,
        subreddit: child.data.subreddit,
        score: child.data.score,
        num_comments: child.data.num_comments,
        url: includeBody ? child.data.url : null,
        permalink: child.data.permalink,
        selftext: includeBody ? (child.data.selftext ?? '') : null,
        is_self: child.data.is_self,
        created_utc: child.data.created_utc,
      })),
      after: data.data.after ?? null,
    };
  },
});
