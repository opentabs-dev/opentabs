import type { RedditListing } from '../reddit-api.js';
import { redditGet } from '../reddit-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface UserContent {
  id: string;
  name: string;
  author: string;
  subreddit: string;
  score: number;
  created_utc: number;
  permalink: string;
  // Post fields
  title?: string;
  selftext?: string;
  url?: string;
  num_comments?: number;
  is_self?: boolean;
  // Comment fields
  body?: string;
  link_title?: string;
  link_id?: string;
  parent_id?: string;
}

const contentItemSchema = z.object({
  kind: z.string().describe('"t3" for post, "t1" for comment'),
  id: z.string().describe('Item ID'),
  name: z.string().describe('Item fullname'),
  author: z.string().describe('Author username'),
  subreddit: z.string().describe('Subreddit name'),
  score: z.number().describe('Score'),
  created_utc: z.number().describe('Creation timestamp'),
  permalink: z.string().describe('Reddit permalink'),
  title: z.string().nullable().describe('Post title (null for comments)'),
  selftext: z.string().nullable().describe('Post body (null for comments, null when include_body is false)'),
  body: z.string().nullable().describe('Comment body (null for posts, null when include_body is false)'),
  link_title: z.string().nullable().describe('Parent post title (for comments)'),
  link_id: z.string().nullable().describe('Parent post fullname, e.g. t3_abc123 (for comments)'),
  parent_id: z.string().nullable().describe('Parent comment/post fullname (for comments)'),
  num_comments: z.number().nullable().describe('Comment count (for posts)'),
});

export const listUserContent = defineTool({
  name: 'list_user_content',
  displayName: 'List User Content',
  description:
    'Browse a user\'s posts, comments, or saved items. Use "submitted" for posts, "comments" for comments, "saved" for saved items (own profile only), "upvoted"/"downvoted" for voted items (own profile only), or "overview" for both posts and comments.',
  summary: "List a user's posts, comments, or saved items",
  icon: 'list',
  group: 'User',
  input: z.object({
    username: z.string().min(1).describe('Reddit username (without u/ prefix)'),
    where: z
      .enum(['overview', 'submitted', 'comments', 'saved', 'upvoted', 'downvoted', 'hidden', 'gilded'])
      .describe('Content type to list'),
    sort: z.enum(['hot', 'new', 'top', 'controversial']).optional().describe('Sort order (default "new")'),
    t: z
      .enum(['hour', 'day', 'week', 'month', 'year', 'all'])
      .optional()
      .describe('Time period for "top" and "controversial" sort'),
    limit: z.number().int().min(1).max(100).optional().describe('Number of results (default 25, max 100)'),
    after: z.string().optional().describe('Pagination cursor for the next page'),
    include_body: z
      .boolean()
      .optional()
      .describe(
        'Whether to include post/comment body text (selftext/body). Defaults to false — titles, link_ids, and metadata only. Set true when you need to read item contents.',
      ),
  }),
  output: z.object({
    items: z.array(contentItemSchema).describe('User content items'),
    after: z.string().nullable().describe('Pagination cursor for next page'),
  }),
  handle: async params => {
    const includeBody = params.include_body ?? false;
    const queryParams: Record<string, string> = {
      limit: String(params.limit ?? 25),
    };
    if (params.sort) queryParams.sort = params.sort;
    if (params.t) queryParams.t = params.t;
    if (params.after) queryParams.after = params.after;

    const data = await redditGet<RedditListing<UserContent>>(
      `/user/${params.username}/${params.where}.json`,
      queryParams,
    );

    return {
      items: data.data.children.map(child => ({
        kind: child.kind,
        id: child.data.id,
        name: child.data.name,
        author: child.data.author ?? '',
        subreddit: child.data.subreddit ?? '',
        score: child.data.score ?? 0,
        created_utc: child.data.created_utc,
        permalink: child.data.permalink,
        title: child.data.title ?? null,
        selftext: includeBody ? (child.data.selftext ?? null) : null,
        body: includeBody ? (child.data.body ?? null) : null,
        link_title: child.data.link_title ?? null,
        link_id: child.data.link_id ?? null,
        parent_id: child.data.parent_id ?? null,
        num_comments: child.data.num_comments ?? null,
      })),
      after: data.data.after ?? null,
    };
  },
});
