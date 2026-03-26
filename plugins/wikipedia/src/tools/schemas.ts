import { z } from 'zod';

/** Strip HTML tags, looping until stable to handle nested/malformed markup */
const stripHtmlTags = (html: string): string => {
  let result = html;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]+>/g, '');
  } while (result !== prev);
  return result;
};

// --- Search result ---

export const searchResultSchema = z.object({
  pageid: z.number().int().describe('Page ID'),
  title: z.string().describe('Article title'),
  snippet: z.string().describe('Search result snippet with match highlights (HTML)'),
  size: z.number().int().describe('Article size in bytes'),
  wordcount: z.number().int().describe('Article word count'),
  timestamp: z.string().describe('Last edit timestamp (ISO 8601)'),
});

export interface RawSearchResult {
  pageid?: number;
  title?: string;
  snippet?: string;
  size?: number;
  wordcount?: number;
  timestamp?: string;
}

export const mapSearchResult = (r: RawSearchResult) => ({
  pageid: r.pageid ?? 0,
  title: r.title ?? '',
  snippet: stripHtmlTags(r.snippet ?? ''),
  size: r.size ?? 0,
  wordcount: r.wordcount ?? 0,
  timestamp: r.timestamp ?? '',
});

// --- Page summary ---

export const pageSummarySchema = z.object({
  pageid: z.number().int().describe('Page ID'),
  title: z.string().describe('Article title'),
  extract: z.string().describe('Plain text extract of the article introduction'),
  description: z.string().describe('Short Wikidata description'),
  url: z.string().describe('Full URL of the article'),
  thumbnail: z.string().describe('Thumbnail image URL (empty if none)'),
  length: z.number().int().describe('Article size in bytes'),
  last_edited: z.string().describe('Last edit timestamp (ISO 8601)'),
  protection: z
    .array(
      z.object({
        type: z.string().describe('Protection type (edit, move)'),
        level: z.string().describe('Protection level (autoconfirmed, sysop)'),
      }),
    )
    .describe('Page protection settings'),
});

export interface RawPage {
  pageid?: number;
  title?: string;
  extract?: string;
  pageprops?: { 'wikibase-shortdesc'?: string };
  fullurl?: string;
  thumbnail?: { source?: string };
  length?: number;
  touched?: string;
  protection?: Array<{ type?: string; level?: string }>;
}

export const mapPageSummary = (p: RawPage) => ({
  pageid: p.pageid ?? 0,
  title: p.title ?? '',
  extract: p.extract ?? '',
  description: p.pageprops?.['wikibase-shortdesc'] ?? '',
  url: p.fullurl ?? '',
  thumbnail: p.thumbnail?.source ?? '',
  length: p.length ?? 0,
  last_edited: p.touched ?? '',
  protection: (p.protection ?? []).map(pr => ({
    type: pr.type ?? '',
    level: pr.level ?? '',
  })),
});

// --- Revision ---

export const revisionSchema = z.object({
  revid: z.number().int().describe('Revision ID'),
  parentid: z.number().int().describe('Parent revision ID'),
  user: z.string().describe('Username of the editor'),
  timestamp: z.string().describe('Edit timestamp (ISO 8601)'),
  comment: z.string().describe('Edit summary'),
  size: z.number().int().describe('Page size after this revision in bytes'),
});

export interface RawRevision {
  revid?: number;
  parentid?: number;
  user?: string;
  timestamp?: string;
  comment?: string;
  size?: number;
}

export const mapRevision = (r: RawRevision) => ({
  revid: r.revid ?? 0,
  parentid: r.parentid ?? 0,
  user: r.user ?? '',
  timestamp: r.timestamp ?? '',
  comment: r.comment ?? '',
  size: r.size ?? 0,
});

// --- Section ---

export const sectionSchema = z.object({
  index: z.string().describe('Section index number'),
  level: z.string().describe('Heading level (2 = H2, 3 = H3, etc.)'),
  line: z.string().describe('Section heading text'),
  number: z.string().describe('Hierarchical section number (e.g., "1.2")'),
  anchor: z.string().describe('URL anchor for this section'),
});

export interface RawSection {
  index?: string;
  level?: string;
  line?: string;
  number?: string;
  anchor?: string;
}

export const mapSection = (s: RawSection) => ({
  index: s.index ?? '',
  level: s.level ?? '',
  line: s.line ?? '',
  number: s.number ?? '',
  anchor: s.anchor ?? '',
});

// --- Category ---

export const categorySchema = z.object({
  title: z.string().describe('Category title (with "Category:" prefix)'),
});

export interface RawCategory {
  title?: string;
}

export const mapCategory = (c: RawCategory) => ({
  title: c.title ?? '',
});

// --- Language link ---

export const langLinkSchema = z.object({
  lang: z.string().describe('Language code (e.g., "fr", "de", "ja")'),
  title: z.string().describe('Article title in that language'),
  url: z.string().describe('Full URL of the article in that language'),
});

export interface RawLangLink {
  lang?: string;
  title?: string;
  url?: string;
  // formatversion=2 uses 'title', formatversion=1 uses '*'
  '*'?: string;
}

export const mapLangLink = (l: RawLangLink) => ({
  lang: l.lang ?? '',
  title: l.title ?? l['*'] ?? '',
  url: l.url ?? '',
});

// --- Recent change ---

export const recentChangeSchema = z.object({
  title: z.string().describe('Page title'),
  user: z.string().describe('Username of the editor'),
  timestamp: z.string().describe('Edit timestamp (ISO 8601)'),
  comment: z.string().describe('Edit summary'),
  old_size: z.number().int().describe('Page size before the edit in bytes'),
  new_size: z.number().int().describe('Page size after the edit in bytes'),
});

export interface RawRecentChange {
  title?: string;
  user?: string;
  timestamp?: string;
  comment?: string;
  oldlen?: number;
  newlen?: number;
}

export const mapRecentChange = (rc: RawRecentChange) => ({
  title: rc.title ?? '',
  user: rc.user ?? '',
  timestamp: rc.timestamp ?? '',
  comment: rc.comment ?? '',
  old_size: rc.oldlen ?? 0,
  new_size: rc.newlen ?? 0,
});

// --- User info ---

export const userInfoSchema = z.object({
  id: z.number().int().describe('User ID'),
  name: z.string().describe('Username'),
  editcount: z.number().int().describe('Total edit count'),
  registration: z.string().describe('Registration date (ISO 8601)'),
  groups: z.array(z.string()).describe('User groups (e.g., "autoconfirmed", "sysop")'),
});

export interface RawUserInfo {
  userid?: number;
  name?: string;
  editcount?: number;
  registration?: string;
  groups?: string[];
}

export const mapUserInfo = (u: RawUserInfo) => ({
  id: u.userid ?? 0,
  name: u.name ?? '',
  editcount: u.editcount ?? 0,
  registration: u.registration ?? '',
  groups: u.groups ?? [],
});

// --- User contribution ---

export const userContribSchema = z.object({
  title: z.string().describe('Page title'),
  revid: z.number().int().describe('Revision ID'),
  timestamp: z.string().describe('Edit timestamp (ISO 8601)'),
  comment: z.string().describe('Edit summary'),
  size: z.number().int().describe('Page size after this revision in bytes'),
});

export interface RawUserContrib {
  title?: string;
  revid?: number;
  timestamp?: string;
  comment?: string;
  size?: number;
}

export const mapUserContrib = (c: RawUserContrib) => ({
  title: c.title ?? '',
  revid: c.revid ?? 0,
  timestamp: c.timestamp ?? '',
  comment: c.comment ?? '',
  size: c.size ?? 0,
});

// --- Random page ---

export const randomPageSchema = z.object({
  id: z.number().int().describe('Page ID'),
  title: z.string().describe('Article title'),
});

export interface RawRandomPage {
  id?: number;
  title?: string;
}

export const mapRandomPage = (p: RawRandomPage) => ({
  id: p.id ?? 0,
  title: p.title ?? '',
});
