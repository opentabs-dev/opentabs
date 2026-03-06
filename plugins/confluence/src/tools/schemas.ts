import { z } from 'zod';

// --- Space schemas ---

export const spaceSchema = z.object({
  id: z.string().describe('Space ID'),
  key: z.string().describe('Space key (e.g., "SD", "~accountid")'),
  name: z.string().describe('Space name'),
  type: z.string().describe('Space type (e.g., "global", "personal")'),
  status: z.string().describe('Space status (e.g., "current")'),
  description: z.string().nullable().describe('Space description'),
  homepage_id: z.string().nullable().describe('ID of the space homepage'),
});

export interface RawSpace {
  id?: string;
  key?: string;
  name?: string;
  type?: string;
  status?: string;
  description?: string | null;
  homepageId?: string | null;
}

export const mapSpace = (s: RawSpace) => ({
  id: s.id ?? '',
  key: s.key ?? '',
  name: s.name ?? '',
  type: s.type ?? '',
  status: s.status ?? '',
  description: typeof s.description === 'string' ? s.description : null,
  homepage_id: s.homepageId ?? null,
});

// --- Page schemas ---

export const versionSchema = z.object({
  number: z.number().describe('Version number'),
  author_id: z.string().describe('Account ID of the version author'),
  created_at: z.string().describe('ISO 8601 timestamp of the version'),
  message: z.string().describe('Version message'),
});

export const pageSchema = z.object({
  id: z.string().describe('Page ID'),
  title: z.string().describe('Page title'),
  space_id: z.string().describe('ID of the space containing the page'),
  status: z.string().describe('Page status (e.g., "current", "draft")'),
  parent_id: z.string().nullable().describe('Parent page ID, or null for top-level pages'),
  author_id: z.string().describe('Account ID of the page author'),
  created_at: z.string().describe('ISO 8601 timestamp of page creation'),
  version: versionSchema.describe('Current version information'),
  web_url: z.string().describe('Relative web URL to view the page'),
});

export interface RawPage {
  id?: string;
  title?: string;
  spaceId?: string;
  status?: string;
  parentId?: string | null;
  authorId?: string;
  createdAt?: string;
  version?: {
    number?: number;
    authorId?: string;
    createdAt?: string;
    message?: string;
  };
  _links?: {
    webui?: string;
  };
}

export const mapPage = (p: RawPage) => ({
  id: p.id ?? '',
  title: p.title ?? '',
  space_id: p.spaceId ?? '',
  status: p.status ?? '',
  parent_id: p.parentId ?? null,
  author_id: p.authorId ?? '',
  created_at: p.createdAt ?? '',
  version: {
    number: p.version?.number ?? 0,
    author_id: p.version?.authorId ?? '',
    created_at: p.version?.createdAt ?? '',
    message: p.version?.message ?? '',
  },
  web_url: p._links?.webui ?? '',
});

// --- Comment schemas ---

export const commentSchema = z.object({
  id: z.string().describe('Comment ID'),
  page_id: z.string().describe('Page ID the comment belongs to'),
  status: z.string().describe('Comment status'),
  title: z.string().describe('Comment title'),
  author_id: z.string().describe('Account ID of the comment author'),
  created_at: z.string().describe('ISO 8601 timestamp of comment creation'),
  body: z.string().describe('Comment body in storage format (HTML)'),
});

export interface RawComment {
  id?: string;
  pageId?: string;
  status?: string;
  title?: string;
  version?: {
    authorId?: string;
    createdAt?: string;
  };
  body?: {
    storage?: {
      value?: string;
    };
  };
}

export const mapComment = (c: RawComment) => ({
  id: c.id ?? '',
  page_id: c.pageId ?? '',
  status: c.status ?? '',
  title: c.title ?? '',
  author_id: c.version?.authorId ?? '',
  created_at: c.version?.createdAt ?? '',
  body: c.body?.storage?.value ?? '',
});

// --- Label schemas ---

export const labelSchema = z.object({
  id: z.string().describe('Label ID'),
  name: z.string().describe('Label name'),
  prefix: z.string().describe('Label prefix (e.g., "global")'),
});

export interface RawLabel {
  id?: string;
  name?: string;
  prefix?: string;
}

export const mapLabel = (l: RawLabel) => ({
  id: l.id ?? '',
  name: l.name ?? '',
  prefix: l.prefix ?? '',
});

// --- Search result schemas ---

export const searchResultSchema = z.object({
  id: z.string().describe('Content ID'),
  title: z.string().describe('Content title'),
  type: z.string().describe('Content type (e.g., "page", "blogpost")'),
  status: z.string().describe('Content status'),
  excerpt: z.string().describe('Text excerpt with search match context'),
  url: z.string().describe('Relative web URL'),
  last_modified: z.string().describe('ISO 8601 timestamp of last modification'),
  space_title: z.string().describe('Title of the containing space'),
});

export interface RawSearchResult {
  content?: {
    id?: string;
    title?: string;
    type?: string;
    status?: string;
  };
  title?: string;
  excerpt?: string;
  url?: string;
  lastModified?: string;
  resultGlobalContainer?: {
    title?: string;
  };
}

export const mapSearchResult = (r: RawSearchResult) => ({
  id: r.content?.id ?? '',
  title: r.content?.title ?? r.title ?? '',
  type: r.content?.type ?? '',
  status: r.content?.status ?? '',
  excerpt: r.excerpt ?? '',
  url: r.url ?? '',
  last_modified: r.lastModified ?? '',
  space_title: r.resultGlobalContainer?.title ?? '',
});

// --- Pagination ---

export const cursorSchema = z
  .string()
  .nullable()
  .describe('Cursor for the next page of results — null if no more pages');

/** Extract the `cursor` query parameter from a Confluence pagination `_links.next` URL. */
export function extractCursor(nextUrl?: string): string | null {
  if (!nextUrl) return null;
  try {
    const url = new URL(nextUrl, 'https://placeholder.com');
    return url.searchParams.get('cursor');
  } catch {
    return null;
  }
}
