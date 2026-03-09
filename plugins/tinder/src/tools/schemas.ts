import { z } from 'zod';

// --- Photo ---

export const photoSchema = z.object({
  id: z.string().describe('Photo ID'),
  url: z.string().describe('Original photo URL'),
  thumbnail: z.string().describe('Small thumbnail URL (84x106)'),
});

export interface RawPhoto {
  id?: string;
  url?: string;
  processedFiles?: Array<{ url?: string; width?: number; height?: number }>;
}

export const mapPhoto = (p: RawPhoto) => ({
  id: p.id ?? '',
  url: p.url ?? '',
  thumbnail:
    p.processedFiles?.find(f => f.width === 84)?.url ??
    p.processedFiles?.[p.processedFiles.length - 1]?.url ??
    p.url ??
    '',
});

// --- User Profile (own) ---

export const profileSchema = z.object({
  id: z.string().describe('User ID'),
  name: z.string().describe('Display name'),
  bio: z.string().describe('Profile bio'),
  birth_date: z.string().describe('Birth date (ISO 8601)'),
  gender: z.number().describe('Gender (0=male, 1=female)'),
  custom_gender: z.string().describe('Custom gender label'),
  photos: z.array(photoSchema).describe('Profile photos'),
  age_filter_min: z.number().describe('Minimum age preference'),
  age_filter_max: z.number().describe('Maximum age preference'),
  distance_filter: z.number().describe('Maximum distance in miles'),
  gender_filter: z.number().describe('Gender preference filter (-1=everyone, 0=male, 1=female)'),
  discoverable: z.boolean().describe('Whether profile is visible to others'),
  create_date: z.string().describe('Account creation date (ISO 8601)'),
  jobs: z
    .array(
      z.object({
        company: z.string().describe('Company name'),
        title: z.string().describe('Job title'),
      }),
    )
    .describe('Job info'),
  schools: z
    .array(
      z.object({
        name: z.string().describe('School name'),
      }),
    )
    .describe('School info'),
  interests: z.array(z.string()).describe('Selected interest names'),
});

export interface RawJob {
  company?: { name?: string };
  title?: { name?: string };
}

export interface RawSchool {
  name?: string;
}

export interface RawInterest {
  name?: string;
}

export interface RawProfile {
  _id?: string;
  name?: string;
  bio?: string;
  birth_date?: string;
  gender?: number;
  custom_gender?: string;
  photos?: RawPhoto[];
  age_filter_min?: number;
  age_filter_max?: number;
  distance_filter?: number;
  gender_filter?: number;
  discoverable?: boolean;
  create_date?: string;
  jobs?: RawJob[];
  schools?: RawSchool[];
  user_interests?: { selected_interests?: RawInterest[] };
}

export const mapProfile = (u: RawProfile) => ({
  id: u._id ?? '',
  name: u.name ?? '',
  bio: u.bio ?? '',
  birth_date: u.birth_date ?? '',
  gender: u.gender ?? 0,
  custom_gender: u.custom_gender ?? '',
  photos: (u.photos ?? []).map(mapPhoto),
  age_filter_min: u.age_filter_min ?? 18,
  age_filter_max: u.age_filter_max ?? 100,
  distance_filter: u.distance_filter ?? 50,
  gender_filter: u.gender_filter ?? -1,
  discoverable: u.discoverable ?? true,
  create_date: u.create_date ?? '',
  jobs: (u.jobs ?? []).map(j => ({
    company: j.company?.name ?? '',
    title: j.title?.name ?? '',
  })),
  schools: (u.schools ?? []).map(s => ({
    name: s.name ?? '',
  })),
  interests: (u.user_interests?.selected_interests ?? []).map(i => i.name ?? ''),
});

// --- Recommendation User ---

export const recUserSchema = z.object({
  id: z.string().describe('User ID'),
  name: z.string().describe('Display name'),
  bio: z.string().describe('Profile bio'),
  birth_date: z.string().describe('Birth date (ISO 8601)'),
  gender: z.number().describe('Gender (0=male, 1=female)'),
  photos: z.array(photoSchema).describe('Profile photos'),
  distance_mi: z.number().describe('Distance in miles'),
  jobs: z
    .array(
      z.object({
        company: z.string().describe('Company name'),
        title: z.string().describe('Job title'),
      }),
    )
    .describe('Job info'),
  schools: z
    .array(
      z.object({
        name: z.string().describe('School name'),
      }),
    )
    .describe('School info'),
  content_hash: z.string().describe('Content hash for swiping'),
  s_number: z.number().describe('S number for swiping'),
});

export interface RawRecResult {
  type?: string;
  user?: {
    _id?: string;
    name?: string;
    bio?: string;
    birth_date?: string;
    gender?: number;
    photos?: RawPhoto[];
    jobs?: RawJob[];
    schools?: RawSchool[];
  };
  distance_mi?: number;
  content_hash?: string;
  s_number?: number;
}

export const mapRecUser = (r: RawRecResult) => ({
  id: r.user?._id ?? '',
  name: r.user?.name ?? '',
  bio: r.user?.bio ?? '',
  birth_date: r.user?.birth_date ?? '',
  gender: r.user?.gender ?? 0,
  photos: (r.user?.photos ?? []).map(mapPhoto),
  distance_mi: r.distance_mi ?? 0,
  jobs: (r.user?.jobs ?? []).map(j => ({
    company: j.company?.name ?? '',
    title: j.title?.name ?? '',
  })),
  schools: (r.user?.schools ?? []).map(s => ({
    name: s.name ?? '',
  })),
  content_hash: r.content_hash ?? '',
  s_number: r.s_number ?? 0,
});

// --- Match ---

export const matchSchema = z.object({
  id: z.string().describe('Match ID'),
  person_id: z.string().describe('Matched person user ID'),
  person_name: z.string().describe('Matched person name'),
  person_bio: z.string().describe('Matched person bio'),
  person_birth_date: z.string().describe('Matched person birth date (ISO 8601)'),
  person_photos: z.array(photoSchema).describe('Matched person photos'),
  message_count: z.number().describe('Number of messages exchanged'),
  last_activity_date: z.string().describe('Last activity timestamp (ISO 8601)'),
  created_date: z.string().describe('Match creation date (ISO 8601)'),
  dead: z.boolean().describe('Whether the match is inactive'),
});

export interface RawMatch {
  _id?: string;
  person?: {
    _id?: string;
    name?: string;
    bio?: string;
    birth_date?: string;
    photos?: RawPhoto[];
  };
  message_count?: number;
  last_activity_date?: string;
  created_date?: string;
  dead?: boolean;
  messages?: RawMessage[];
}

export const mapMatch = (m: RawMatch) => ({
  id: m._id ?? '',
  person_id: m.person?._id ?? '',
  person_name: m.person?.name ?? '',
  person_bio: m.person?.bio ?? '',
  person_birth_date: m.person?.birth_date ?? '',
  person_photos: (m.person?.photos ?? []).map(mapPhoto),
  message_count: m.message_count ?? 0,
  last_activity_date: m.last_activity_date ?? '',
  created_date: m.created_date ?? '',
  dead: m.dead ?? false,
});

// --- Message ---

export const messageSchema = z.object({
  id: z.string().describe('Message ID'),
  match_id: z.string().describe('Match ID this message belongs to'),
  from: z.string().describe('Sender user ID'),
  to: z.string().describe('Recipient user ID'),
  message: z.string().describe('Message text'),
  sent_date: z.string().describe('Sent timestamp (ISO 8601)'),
});

export interface RawMessage {
  _id?: string;
  match_id?: string;
  from?: string;
  to?: string;
  message?: string;
  sent_date?: string;
}

export const mapMessage = (m: RawMessage) => ({
  id: m._id ?? '',
  match_id: m.match_id ?? '',
  from: m.from ?? '',
  to: m.to ?? '',
  message: m.message ?? '',
  sent_date: m.sent_date ?? '',
});

// --- Other User ---

export const userSchema = z.object({
  id: z.string().describe('User ID'),
  name: z.string().describe('Display name'),
  bio: z.string().describe('Profile bio'),
  birth_date: z.string().describe('Birth date (ISO 8601)'),
  gender: z.number().describe('Gender (0=male, 1=female)'),
  photos: z.array(photoSchema).describe('Profile photos'),
  distance_mi: z.number().describe('Distance in miles'),
});

export interface RawUser {
  _id?: string;
  name?: string;
  bio?: string;
  birth_date?: string;
  gender?: number;
  photos?: RawPhoto[];
  distance_mi?: number;
}

export const mapUser = (u: RawUser) => ({
  id: u._id ?? '',
  name: u.name ?? '',
  bio: u.bio ?? '',
  birth_date: u.birth_date ?? '',
  gender: u.gender ?? 0,
  photos: (u.photos ?? []).map(mapPhoto),
  distance_mi: u.distance_mi ?? 0,
});

// --- Tinder API Response Envelope ---

export interface TinderResponse<T> {
  meta?: { status?: number };
  data?: T;
}
