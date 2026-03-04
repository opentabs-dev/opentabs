import { z } from 'zod';

// ---------------------------------------------------------------------------
// File schema
// ---------------------------------------------------------------------------

export const fileSchema = z.object({
  key: z.string().describe('Unique file key identifier'),
  name: z.string().describe('File name'),
  description: z.string().nullable().describe('File description'),
  editor_type: z.string().describe('Editor type (design, figjam, slides)'),
  team_id: z.string().describe('Team ID the file belongs to'),
  folder_id: z.string().describe('Folder/project ID containing the file'),
  creator_id: z.string().describe('User ID of the file creator'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last updated timestamp'),
  thumbnail_url: z.string().nullable().describe('URL to the file thumbnail image'),
  url: z.string().describe('URL to open the file in Figma'),
  link_access: z.string().describe('Link sharing access level (view, edit, inherit)'),
  trashed_at: z.string().nullable().describe('ISO 8601 timestamp when file was trashed, or null'),
});

export interface RawFile {
  key?: string;
  name?: string;
  description?: string | null;
  editor_type?: string;
  team_id?: string;
  folder_id?: string;
  creator_id?: string;
  created_at?: string;
  updated_at?: string;
  thumbnail_url?: string | null;
  url?: string;
  edit_url?: string;
  link_access?: string;
  trashed_at?: string | null;
}

export const mapFile = (f: Partial<RawFile>): z.infer<typeof fileSchema> => ({
  key: f.key ?? '',
  name: f.name ?? '',
  description: f.description ?? null,
  editor_type: f.editor_type ?? 'design',
  team_id: f.team_id ?? '',
  folder_id: f.folder_id ?? '',
  creator_id: f.creator_id ?? '',
  created_at: f.created_at ?? '',
  updated_at: f.updated_at ?? '',
  thumbnail_url: f.thumbnail_url ?? null,
  url: f.url ?? f.edit_url ?? '',
  link_access: f.link_access ?? '',
  trashed_at: f.trashed_at ?? null,
});

// ---------------------------------------------------------------------------
// User schema
// ---------------------------------------------------------------------------

export const userSchema = z.object({
  id: z.string().describe('User ID'),
  name: z.string().describe('Display name'),
  handle: z.string().describe('User handle'),
  email: z.string().describe('Email address'),
  img_url: z.string().describe('Profile image URL'),
  created_at: z.string().describe('ISO 8601 account creation timestamp'),
});

export interface RawUser {
  id?: string;
  name?: string;
  handle?: string;
  email?: string;
  img_url?: string;
  created_at?: string;
}

export const mapUser = (u: Partial<RawUser>): z.infer<typeof userSchema> => ({
  id: u.id ?? '',
  name: u.name ?? '',
  handle: u.handle ?? '',
  email: u.email ?? '',
  img_url: u.img_url ?? '',
  created_at: u.created_at ?? '',
});

// ---------------------------------------------------------------------------
// Team schema
// ---------------------------------------------------------------------------

export const teamSchema = z.object({
  id: z.string().describe('Team ID'),
  name: z.string().describe('Team name'),
  description: z.string().nullable().describe('Team description'),
  img_url: z.string().nullable().describe('Team avatar URL'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  editors: z.number().describe('Number of editors in the team'),
  is_paid: z.boolean().describe('Whether the team is on a paid plan'),
});

export interface RawTeam {
  id?: string;
  name?: string;
  description?: string | null;
  img_url?: string | null;
  created_at?: string;
  editors?: number;
  is_paid?: boolean;
}

export const mapTeam = (t: Partial<RawTeam>): z.infer<typeof teamSchema> => ({
  id: t.id ?? '',
  name: t.name ?? '',
  description: t.description ?? null,
  img_url: t.img_url ?? null,
  created_at: t.created_at ?? '',
  editors: t.editors ?? 0,
  is_paid: t.is_paid ?? false,
});

// ---------------------------------------------------------------------------
// Comment schema
// ---------------------------------------------------------------------------

export const commentSchema = z.object({
  id: z.string().describe('Comment ID'),
  message: z.string().describe('Comment text'),
  user_id: z.string().describe('User ID of the commenter'),
  user_handle: z.string().describe('Display name of the commenter'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  resolved_at: z.string().nullable().describe('ISO 8601 timestamp when resolved, or null'),
  parent_id: z.string().nullable().describe('Parent comment ID for replies, or null'),
});

export interface RawComment {
  id?: string;
  message?: string;
  user_id?: string;
  user_handle?: string;
  user?: { id?: string; handle?: string };
  created_at?: string;
  resolved_at?: string | null;
  parent_id?: string | null;
}

export const mapComment = (c: Partial<RawComment>): z.infer<typeof commentSchema> => ({
  id: String(c.id ?? ''),
  message: c.message ?? '',
  user_id: c.user_id ?? c.user?.id ?? '',
  user_handle: c.user_handle ?? c.user?.handle ?? '',
  created_at: c.created_at ?? '',
  resolved_at: c.resolved_at ?? null,
  parent_id: c.parent_id ? String(c.parent_id) : null,
});
