import { z } from 'zod';
import type { ParsedStory, ParsedItem, ParsedComment, ParsedUser } from '../hackernews-api.js';

// --- Story schema (used by list endpoints) ---

export const storySchema = z.object({
  id: z.number().int().describe('Unique item ID'),
  title: z.string().describe('Story title'),
  url: z.string().describe('URL of the story (empty for text posts)'),
  site: z.string().describe('Domain of the URL (empty for text posts)'),
  score: z.number().int().describe('Score (points)'),
  by: z.string().describe('Username of the author'),
  time: z.string().describe('Creation time as ISO 8601 timestamp'),
  descendants: z.number().int().describe('Total comment count'),
});

export const mapStory = (s: ParsedStory) => ({
  id: s.id,
  title: s.title,
  url: s.url,
  site: s.site,
  score: s.score,
  by: s.by,
  time: s.time,
  descendants: s.descendants,
});

// --- Item schema (full detail for a single item) ---

export const itemSchema = z.object({
  id: z.number().int().describe('Unique item ID'),
  type: z.string().describe('Item type: story, comment, or job'),
  title: z.string().describe('Title (stories and jobs only)'),
  url: z.string().describe('URL of the story (empty for text posts)'),
  text: z.string().describe('HTML text content (comments, Ask HN, jobs)'),
  score: z.number().int().describe('Score (points)'),
  by: z.string().describe('Username of the author'),
  time: z.string().describe('Creation time as ISO 8601 timestamp'),
  descendants: z.number().int().describe('Total comment count'),
});

export const mapItem = (i: ParsedItem) => ({
  id: i.id,
  type: i.type,
  title: i.title,
  url: i.url,
  text: i.text,
  score: i.score,
  by: i.by,
  time: i.time,
  descendants: i.descendants,
});

// --- Comment schema ---

export const commentSchema = z.object({
  id: z.number().int().describe('Comment ID'),
  by: z.string().describe('Author username'),
  text: z.string().describe('Comment text (HTML)'),
  time: z.string().describe('Creation time as ISO 8601 timestamp'),
  indent: z.number().int().describe('Nesting depth (0 = top-level)'),
});

export const mapComment = (c: ParsedComment) => ({
  id: c.id,
  by: c.by,
  text: c.text,
  time: c.time,
  indent: c.indent,
});

// --- User schema ---

export const userSchema = z.object({
  username: z.string().describe('Username (case-sensitive)'),
  created: z.string().describe('Account creation date (human-readable)'),
  karma: z.number().int().describe('Karma score'),
  about: z.string().describe('User bio (HTML)'),
});

export const mapUser = (u: ParsedUser) => ({
  username: u.username,
  created: u.created,
  karma: u.karma,
  about: u.about,
});
