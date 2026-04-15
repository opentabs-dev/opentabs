import { z } from 'zod';

// --- Shared Output Schemas ---

export const questionSchema = z.object({
  question_id: z.number().describe('Question ID'),
  title: z.string().describe('Question title'),
  body: z.string().describe('Question body in HTML'),
  tags: z.array(z.string()).describe('Tags applied to the question'),
  score: z.number().describe('Net vote score'),
  answer_count: z.number().describe('Number of answers'),
  view_count: z.number().describe('Number of views'),
  is_answered: z.boolean().describe('Whether the question has an accepted answer'),
  accepted_answer_id: z.number().describe('Accepted answer ID (0 if none)'),
  creation_date: z.string().describe('Creation date as ISO 8601 timestamp'),
  last_activity_date: z.string().describe('Last activity date as ISO 8601 timestamp'),
  link: z.string().describe('URL to the question page'),
  owner_display_name: z.string().describe('Question author display name'),
  owner_reputation: z.number().describe('Question author reputation'),
  owner_user_id: z.number().describe('Question author user ID'),
  bounty_amount: z.number().describe('Bounty amount (0 if no active bounty)'),
  closed_reason: z.string().describe('Close reason (empty if open)'),
});

export const answerSchema = z.object({
  answer_id: z.number().describe('Answer ID'),
  question_id: z.number().describe('Parent question ID'),
  body: z.string().describe('Answer body in HTML'),
  score: z.number().describe('Net vote score'),
  is_accepted: z.boolean().describe('Whether this is the accepted answer'),
  creation_date: z.string().describe('Creation date as ISO 8601 timestamp'),
  last_activity_date: z.string().describe('Last activity date as ISO 8601 timestamp'),
  owner_display_name: z.string().describe('Answer author display name'),
  owner_reputation: z.number().describe('Answer author reputation'),
  owner_user_id: z.number().describe('Answer author user ID'),
});

export const commentSchema = z.object({
  comment_id: z.number().describe('Comment ID'),
  post_id: z.number().describe('Parent post ID (question or answer)'),
  body: z.string().describe('Comment body in HTML'),
  score: z.number().describe('Comment vote score'),
  creation_date: z.string().describe('Creation date as ISO 8601 timestamp'),
  owner_display_name: z.string().describe('Comment author display name'),
  owner_user_id: z.number().describe('Comment author user ID'),
});

export const userSchema = z.object({
  user_id: z.number().describe('User ID'),
  display_name: z.string().describe('Display name'),
  reputation: z.number().describe('Reputation score'),
  profile_image: z.string().describe('Profile image URL'),
  link: z.string().describe('Profile page URL'),
  accept_rate: z.number().describe('Accept rate percentage (0 if not available)'),
  question_count: z.number().describe('Number of questions asked'),
  answer_count: z.number().describe('Number of answers posted'),
  creation_date: z.string().describe('Account creation date as ISO 8601 timestamp'),
  last_access_date: z.string().describe('Last access date as ISO 8601 timestamp'),
  location: z.string().describe('User location (empty if not set)'),
  website_url: z.string().describe('User website URL (empty if not set)'),
  badge_gold: z.number().describe('Number of gold badges'),
  badge_silver: z.number().describe('Number of silver badges'),
  badge_bronze: z.number().describe('Number of bronze badges'),
});

export const tagSchema = z.object({
  name: z.string().describe('Tag name'),
  count: z.number().describe('Number of questions with this tag'),
  has_synonyms: z.boolean().describe('Whether the tag has synonyms'),
  is_moderator_only: z.boolean().describe('Whether only moderators can use this tag'),
  is_required: z.boolean().describe('Whether this tag is required'),
});

export const tagInfoSchema = tagSchema.extend({
  excerpt: z.string().describe('Tag excerpt description'),
  wiki_body: z.string().describe('Full tag wiki body in HTML'),
});

export const searchExcerptSchema = z.object({
  question_id: z.number().describe('Question ID'),
  answer_id: z.number().describe('Answer ID (0 if this is a question result)'),
  title: z.string().describe('Question title'),
  excerpt: z.string().describe('Search result excerpt with highlights'),
  item_type: z.string().describe('Result type: "question" or "answer"'),
  tags: z.array(z.string()).describe('Tags (for question results)'),
  score: z.number().describe('Net vote score'),
  is_answered: z.boolean().describe('Whether the question is answered'),
  creation_date: z.string().describe('Creation date as ISO 8601 timestamp'),
});

type RawData = Record<string, unknown>;

// --- Defensive Mappers ---

const unixToIso = (ts?: number): string => (ts ? new Date(ts * 1000).toISOString() : '');

const nested = (v: unknown): RawData | undefined => (typeof v === 'object' && v !== null ? (v as RawData) : undefined);

export const mapQuestion = (q: RawData) =>
  ({
    question_id: q.question_id ?? 0,
    title: q.title ?? '',
    body: q.body ?? '',
    tags: q.tags ?? [],
    score: q.score ?? 0,
    answer_count: q.answer_count ?? 0,
    view_count: q.view_count ?? 0,
    is_answered: q.is_answered ?? false,
    accepted_answer_id: q.accepted_answer_id ?? 0,
    creation_date: unixToIso(q.creation_date as number | undefined),
    last_activity_date: unixToIso(q.last_activity_date as number | undefined),
    link: q.link ?? '',
    owner_display_name: nested(q.owner)?.display_name ?? '',
    owner_reputation: nested(q.owner)?.reputation ?? 0,
    owner_user_id: nested(q.owner)?.user_id ?? 0,
    bounty_amount: q.bounty_amount ?? 0,
    closed_reason: q.closed_reason ?? '',
  }) as z.infer<typeof questionSchema>;

export const mapAnswer = (a: RawData) =>
  ({
    answer_id: a.answer_id ?? 0,
    question_id: a.question_id ?? 0,
    body: a.body ?? '',
    score: a.score ?? 0,
    is_accepted: a.is_accepted ?? false,
    creation_date: unixToIso(a.creation_date as number | undefined),
    last_activity_date: unixToIso(a.last_activity_date as number | undefined),
    owner_display_name: nested(a.owner)?.display_name ?? '',
    owner_reputation: nested(a.owner)?.reputation ?? 0,
    owner_user_id: nested(a.owner)?.user_id ?? 0,
  }) as z.infer<typeof answerSchema>;

export const mapComment = (c: RawData) =>
  ({
    comment_id: c.comment_id ?? 0,
    post_id: c.post_id ?? 0,
    body: c.body ?? '',
    score: c.score ?? 0,
    creation_date: unixToIso(c.creation_date as number | undefined),
    owner_display_name: nested(c.owner)?.display_name ?? '',
    owner_user_id: nested(c.owner)?.user_id ?? 0,
  }) as z.infer<typeof commentSchema>;

export const mapUser = (u: RawData) =>
  ({
    user_id: u.user_id ?? 0,
    display_name: u.display_name ?? '',
    reputation: u.reputation ?? 0,
    profile_image: u.profile_image ?? '',
    link: u.link ?? '',
    accept_rate: u.accept_rate ?? 0,
    question_count: u.question_count ?? 0,
    answer_count: u.answer_count ?? 0,
    creation_date: unixToIso(u.creation_date as number | undefined),
    last_access_date: unixToIso(u.last_access_date as number | undefined),
    location: u.location ?? '',
    website_url: u.website_url ?? '',
    badge_gold: nested(u.badge_counts)?.gold ?? 0,
    badge_silver: nested(u.badge_counts)?.silver ?? 0,
    badge_bronze: nested(u.badge_counts)?.bronze ?? 0,
  }) as z.infer<typeof userSchema>;

export const mapTag = (t: RawData) =>
  ({
    name: t.name ?? '',
    count: t.count ?? 0,
    has_synonyms: t.has_synonyms ?? false,
    is_moderator_only: t.is_moderator_only ?? false,
    is_required: t.is_required ?? false,
  }) as z.infer<typeof tagSchema>;

export const mapTagInfo = (t: RawData, wiki?: RawData) =>
  ({
    ...mapTag(t),
    excerpt: wiki?.excerpt ?? '',
    wiki_body: wiki?.body ?? '',
  }) as z.infer<typeof tagInfoSchema>;

export const mapSearchExcerpt = (s: RawData) =>
  ({
    question_id: s.question_id ?? 0,
    answer_id: s.answer_id ?? 0,
    title: s.title ?? '',
    excerpt: s.excerpt ?? '',
    item_type: s.item_type ?? '',
    tags: s.tags ?? [],
    score: s.score ?? 0,
    is_answered: s.is_answered ?? false,
    creation_date: unixToIso(s.creation_date as number | undefined),
  }) as z.infer<typeof searchExcerptSchema>;
