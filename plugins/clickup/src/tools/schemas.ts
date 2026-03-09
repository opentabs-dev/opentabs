import { z } from 'zod';

// --- User ---

export const userSchema = z.object({
  id: z.number().describe('User ID'),
  username: z.string().describe('Display name'),
  email: z.string().describe('Email address'),
  color: z.string().describe('Avatar color hex code'),
  initials: z.string().describe('User initials'),
  profile_picture: z.string().nullable().describe('Profile picture URL or null'),
  timezone: z.string().describe('IANA timezone (e.g., America/Los_Angeles)'),
});

interface RawUser {
  id?: number;
  username?: string;
  email?: string;
  color?: string;
  initials?: string;
  profilePicture?: string | null;
  timezone?: string;
}

export const mapUser = (u: RawUser) => ({
  id: u.id ?? 0,
  username: u.username ?? '',
  email: u.email ?? '',
  color: u.color ?? '',
  initials: u.initials ?? '',
  profile_picture: u.profilePicture ?? null,
  timezone: u.timezone ?? '',
});

// --- Workspace Member ---

export const memberSchema = z.object({
  id: z.number().describe('User ID'),
  username: z.string().describe('Display name'),
  email: z.string().describe('Email address'),
  color: z.string().describe('Avatar color hex code'),
  initials: z.string().describe('User initials'),
  profile_picture: z.string().nullable().describe('Profile picture URL or null'),
  role: z.number().describe('Role ID (1=Owner, 2=Admin, 3=Member, 4=Guest)'),
});

interface RawMemberUser {
  id?: number;
  username?: string;
  email?: string;
  color?: string;
  initials?: string;
  profilePicture?: string | null;
}

interface RawMember {
  user?: RawMemberUser;
  role?: number;
}

export const mapMember = (m: RawMember) => ({
  id: m.user?.id ?? 0,
  username: m.user?.username ?? '',
  email: m.user?.email ?? '',
  color: m.user?.color ?? '',
  initials: m.user?.initials ?? '',
  profile_picture: m.user?.profilePicture ?? null,
  role: m.role ?? 0,
});

// --- Workspace ---

export const workspaceSchema = z.object({
  id: z.string().describe('Workspace ID'),
  name: z.string().describe('Workspace name'),
  color: z.string().describe('Workspace color hex code'),
  plan_id: z.string().describe('Plan ID (e.g., "13" for Free Forever)'),
  member_count: z.number().describe('Number of billed users this cycle'),
  date_created: z.string().describe('Unix timestamp in milliseconds'),
  owner: userSchema.omit({ timezone: true }).describe('Workspace owner'),
});

interface RawWorkspace {
  id?: string;
  name?: string;
  color?: string;
  plan_id?: string;
  billed_users_this_cycle?: number;
  date_created?: string;
  owner?: RawUser;
}

export const mapWorkspace = (w: RawWorkspace) => ({
  id: w.id ?? '',
  name: w.name ?? '',
  color: w.color ?? '',
  plan_id: w.plan_id ?? '',
  member_count: w.billed_users_this_cycle ?? 0,
  date_created: w.date_created ?? '',
  owner: {
    id: w.owner?.id ?? 0,
    username: w.owner?.username ?? '',
    email: w.owner?.email ?? '',
    color: w.owner?.color ?? '',
    initials: w.owner?.initials ?? '',
    profile_picture: w.owner?.profilePicture ?? null,
  },
});

// --- Space ---

export const spaceSchema = z.object({
  id: z.string().describe('Space ID'),
  name: z.string().describe('Space name'),
  color: z.string().describe('Space color hex code'),
  private: z.boolean().describe('Whether the space is private'),
  archived: z.boolean().describe('Whether the space is archived'),
  date_created: z.string().describe('Unix timestamp in milliseconds'),
  multiple_assignees: z.boolean().describe('Whether multiple assignees are enabled'),
});

interface RawSpace {
  id?: string;
  name?: string;
  color?: string;
  private?: boolean;
  archived?: boolean;
  date_created?: string;
  multiple_assignees?: boolean;
}

export const mapSpace = (s: RawSpace) => ({
  id: s.id ?? '',
  name: s.name ?? '',
  color: s.color ?? '',
  private: s.private ?? false,
  archived: s.archived ?? false,
  date_created: s.date_created ?? '',
  multiple_assignees: s.multiple_assignees ?? false,
});

// --- Folder ---

export const folderSchema = z.object({
  id: z.string().describe('Folder ID'),
  name: z.string().describe('Folder name'),
  orderindex: z.number().describe('Display order index'),
  archived: z.boolean().describe('Whether the folder is archived'),
  hidden: z.boolean().describe('Whether the folder is hidden'),
  space_id: z.string().describe('Parent space ID'),
  date_updated: z.string().describe('Unix timestamp in milliseconds'),
});

interface RawFolder {
  id?: string;
  name?: string;
  orderindex?: number;
  archived?: boolean;
  hidden?: boolean;
  project_id?: string;
  date_updated?: string;
}

export const mapFolder = (f: RawFolder) => ({
  id: f.id ?? '',
  name: f.name ?? '',
  orderindex: f.orderindex ?? 0,
  archived: f.archived ?? false,
  hidden: f.hidden ?? false,
  space_id: f.project_id ?? '',
  date_updated: f.date_updated ?? '',
});

// --- List ---

export const listSchema = z.object({
  id: z.string().describe('List ID'),
  name: z.string().describe('List name'),
  orderindex: z.number().describe('Display order index'),
  archived: z.boolean().describe('Whether the list is archived'),
  due_date: z.string().nullable().describe('Due date (Unix timestamp in ms) or null'),
  start_date: z.string().nullable().describe('Start date (Unix timestamp in ms) or null'),
  folder_id: z.string().describe('Parent folder ID'),
  space_id: z.string().describe('Parent space ID'),
  date_updated: z.string().describe('Unix timestamp in milliseconds'),
  task_count: z.number().describe('Number of tasks in the list'),
});

interface RawList {
  id?: string;
  name?: string;
  orderindex?: number;
  archived?: boolean;
  due_date?: string | null;
  start_date?: string | null;
  category?: { id?: string } | null;
  project?: { id?: string } | null;
  date_updated?: string;
  task_count?: number;
}

export const mapList = (l: RawList) => ({
  id: l.id ?? '',
  name: l.name ?? '',
  orderindex: l.orderindex ?? 0,
  archived: l.archived ?? false,
  due_date: l.due_date ?? null,
  start_date: l.start_date ?? null,
  folder_id: l.category?.id ?? '',
  space_id: l.project?.id ?? '',
  date_updated: l.date_updated ?? '',
  task_count: l.task_count ?? 0,
});

// --- Goal ---

export const goalSchema = z.object({
  id: z.string().describe('Goal ID'),
  name: z.string().describe('Goal name'),
  description: z.string().describe('Goal description'),
  color: z.string().describe('Goal color hex code'),
  date_created: z.string().describe('Unix timestamp in milliseconds'),
  due_date: z.string().nullable().describe('Due date (Unix timestamp in ms) or null'),
  percent_completed: z.number().describe('Completion percentage (0-100)'),
  owner_id: z.number().describe('Owner user ID'),
  folder_id: z.string().nullable().describe('Goal folder ID or null'),
  multiple_owners: z.boolean().describe('Whether multiple owners are enabled'),
  key_result_count: z.number().describe('Number of key results'),
});

interface RawGoal {
  id?: string;
  name?: string;
  description?: string;
  color?: string;
  date_created?: string;
  due_date?: string | null;
  percent_completed?: number;
  creator?: number;
  folder_id?: string | null;
  multiple_owners?: boolean;
  key_results?: unknown[];
}

export const mapGoal = (g: RawGoal) => ({
  id: g.id ?? '',
  name: g.name ?? '',
  description: g.description ?? '',
  color: g.color ?? '',
  date_created: g.date_created ?? '',
  due_date: g.due_date ?? null,
  percent_completed: g.percent_completed ?? 0,
  owner_id: g.creator ?? 0,
  folder_id: g.folder_id ?? null,
  multiple_owners: g.multiple_owners ?? false,
  key_result_count: (g.key_results ?? []).length,
});

// --- Custom Field ---

export const customFieldSchema = z.object({
  id: z.string().describe('Custom field ID'),
  name: z.string().describe('Field name'),
  type: z.string().describe('Field type (e.g., text, number, drop_down, checkbox, date, email, url)'),
  required: z.boolean().describe('Whether the field is required'),
});

interface RawCustomField {
  id?: string;
  name?: string;
  type?: string;
  required?: boolean;
}

export const mapCustomField = (f: RawCustomField) => ({
  id: f.id ?? '',
  name: f.name ?? '',
  type: f.type ?? '',
  required: f.required ?? false,
});

// --- Status ---

export const statusSchema = z.object({
  status: z.string().describe('Status name'),
  color: z.string().describe('Status color hex code'),
  orderindex: z.number().describe('Display order'),
  type: z.string().describe('Status type (e.g., open, custom, closed, done)'),
});

interface RawStatus {
  status?: string;
  color?: string;
  orderindex?: number;
  type?: string;
}

export const mapStatus = (s: RawStatus) => ({
  status: s.status ?? '',
  color: s.color ?? '',
  orderindex: s.orderindex ?? 0,
  type: s.type ?? '',
});
