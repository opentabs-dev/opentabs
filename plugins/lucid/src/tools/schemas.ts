import { z } from 'zod';

// --- User ---

export const userSchema = z.object({
  id: z.string().describe('User ID'),
  email: z.string().describe('Email address'),
  first_name: z.string().describe('First name'),
  last_name: z.string().describe('Last name'),
  active: z.boolean().describe('Whether the user is active'),
  created: z.string().describe('ISO 8601 creation timestamp'),
  last_login: z.string().describe('ISO 8601 last login timestamp'),
  data_region: z.string().describe('Data region (e.g., "us")'),
});

export interface RawUser {
  uri?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
  created?: string;
  lastLogin?: string;
  dataRegion?: string;
}

export const mapUser = (u: RawUser) => ({
  id: extractId(u.uri ?? ''),
  email: u.email ?? '',
  first_name: u.firstName ?? '',
  last_name: u.lastName ?? '',
  active: u.active ?? false,
  created: u.created ?? '',
  last_login: u.lastLogin ?? '',
  data_region: u.dataRegion ?? '',
});

// --- Account ---

export const accountSchema = z.object({
  id: z.string().describe('Account ID'),
  name: z.string().describe('Account name'),
  size: z.number().int().describe('Number of users in the account'),
  created: z.string().describe('ISO 8601 creation timestamp'),
});

export interface RawAccount {
  uri?: string;
  name?: string | null;
  size?: number;
  created?: string;
}

export const mapAccount = (a: RawAccount) => ({
  id: extractId(a.uri ?? ''),
  name: a.name ?? '',
  size: a.size ?? 0,
  created: a.created ?? '',
});

// --- Group ---

export const groupSchema = z.object({
  id: z.string().describe('Group ID'),
  name: z.string().describe('Group name'),
  created: z.string().describe('ISO 8601 creation timestamp'),
  user_count: z.number().int().describe('Number of users in the group'),
});

export interface RawGroup {
  id?: number;
  name?: string;
  created?: string;
  users?: string[];
}

export const mapGroup = (g: RawGroup) => ({
  id: String(g.id ?? ''),
  name: g.name ?? '',
  created: g.created ?? '',
  user_count: g.users?.length ?? 0,
});

// --- Document ---

export const documentSchema = z.object({
  id: z.string().describe('Document UUID'),
  title: z.string().describe('Document title'),
  product: z.string().describe('Product type: chart, press, or spark'),
  created: z.string().describe('ISO 8601 creation timestamp'),
  saved: z.string().describe('ISO 8601 last saved timestamp'),
  deleted: z.string().nullable().describe('ISO 8601 deletion timestamp, or null if not trashed'),
  size: z.number().int().describe('Document size in bytes'),
  pages: z.number().int().describe('Number of pages'),
  edit_url: z.string().describe('URL to open the document in the editor'),
});

export interface RawDocument {
  uri?: string;
  title?: string;
  product?: string;
  created?: string;
  saved?: string;
  deleted?: string | null;
  size?: number;
  edit?: string;
  // From document list response
  Document?: {
    id?: string;
    title?: string;
    product_id?: number;
    created?: string;
    createdTimestamp?: number;
    saved?: string;
    savedTimestamp?: number;
    deleted?: string | null;
    size?: number;
    pages?: number;
    action_history_length?: number;
  };
}

const PRODUCT_MAP: Record<number, string> = {
  0: 'chart',
  1: 'press',
  2: 'spark',
};

export const mapDocument = (d: RawDocument) => {
  const inner = d.Document;
  if (inner) {
    return {
      id: inner.id ?? '',
      title: inner.title ?? '',
      product: PRODUCT_MAP[inner.product_id ?? 0] ?? 'chart',
      created: inner.created ?? '',
      saved: inner.saved ?? '',
      deleted: inner.deleted ?? null,
      size: inner.size ?? 0,
      pages: inner.pages ?? 0,
      edit_url: `https://lucid.app/lucidchart/${inner.id}/edit`,
    };
  }
  return {
    id: extractDocId(d.uri ?? ''),
    title: d.title ?? '',
    product: d.product ?? 'chart',
    created: d.created ?? '',
    saved: d.saved ?? '',
    deleted: d.deleted ?? null,
    size: d.size ?? 0,
    pages: 0,
    edit_url: d.edit ?? '',
  };
};

// --- Document List Item (richer response from userdocslist) ---

export const documentListItemSchema = z.object({
  id: z.string().describe('Document UUID'),
  title: z.string().describe('Document title'),
  product: z.string().describe('Product type: chart, press, or spark'),
  created: z.string().describe('ISO 8601 creation timestamp'),
  saved: z.string().describe('ISO 8601 last saved timestamp'),
  deleted: z.string().nullable().describe('ISO 8601 deletion timestamp, or null'),
  size: z.number().int().describe('Document size in bytes'),
  pages: z.number().int().describe('Number of pages'),
  creator_name: z.string().describe('Name of the document creator'),
  edit_url: z.string().describe('URL to open the document in the editor'),
  starred: z.boolean().describe('Whether the document is starred'),
  in_project: z.boolean().describe('Whether the document is in a project'),
});

export interface RawDocumentListItem {
  id?: string;
  Document?: {
    id?: string;
    title?: string;
    product_id?: number;
    created?: string;
    saved?: string;
    deleted?: string | null;
    size?: number;
    pages?: number;
  };
  Creator?: {
    id?: number;
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  starred?: boolean;
  inProject?: boolean;
}

export const mapDocumentListItem = (d: RawDocumentListItem) => {
  const doc = d.Document;
  const productId = doc?.product_id ?? 0;
  const docId = doc?.id ?? d.id ?? '';
  const productName = PRODUCT_MAP[productId] ?? 'chart';
  const productPath = productName === 'press' ? 'lucidspark' : productName === 'spark' ? 'lucidscale' : 'lucidchart';
  return {
    id: docId,
    title: doc?.title ?? '',
    product: productName,
    created: doc?.created ?? '',
    saved: doc?.saved ?? '',
    deleted: doc?.deleted ?? null,
    size: doc?.size ?? 0,
    pages: doc?.pages ?? 0,
    creator_name: [d.Creator?.first_name, d.Creator?.last_name].filter(Boolean).join(' ') || d.Creator?.email || '',
    edit_url: `https://lucid.app/${productPath}/${docId}/edit`,
    starred: d.starred ?? false,
    in_project: d.inProject ?? false,
  };
};

// --- Page ---

export const pageSchema = z.object({
  id: z.string().describe('Page ID (e.g., "0_0")'),
  index: z.number().int().describe('Page index (0-based)'),
  title: z.string().describe('Page title'),
  is_template: z.boolean().describe('Whether this is a template page'),
  thumb_url: z.string().describe('Thumbnail image URL'),
});

export interface RawPage {
  id?: string;
  index?: number;
  title?: string;
  isTemplate?: boolean;
  thumb?: string;
}

export const mapPage = (p: RawPage) => ({
  id: p.id ?? '',
  index: p.index ?? 0,
  title: p.title ?? '',
  is_template: p.isTemplate ?? false,
  thumb_url: p.thumb ?? '',
});

// --- Folder Entry ---

export const folderEntrySchema = z.object({
  id: z.string().describe('Folder entry ID'),
  name: z.string().describe('Folder name (empty for document entries)'),
  document_id: z.string().describe('Associated document ID (empty for folders)'),
  parent_id: z.string().describe('Parent folder entry ID (empty for root entries)'),
  created: z.string().describe('ISO 8601 creation timestamp'),
  deleted: z.string().nullable().describe('ISO 8601 deletion timestamp, or null'),
  is_project: z.boolean().describe('Whether this is a project folder'),
  is_shortcut: z.boolean().describe('Whether this is a shortcut entry'),
  entry_type: z.string().describe('Entry type'),
});

export interface RawFolderEntry {
  uri?: string;
  id?: number;
  name?: string | null;
  document?: string | null;
  parent?: string | null;
  created?: string;
  deleted?: string | null;
  isProject?: boolean;
  isShortcut?: boolean;
  entryType?: string;
  // List response format
  FolderEntry?: {
    id?: number;
    document_id?: string | null;
    parent_id?: number | null;
    name?: string | null;
    created?: string;
    deleted?: string | null;
    is_project?: boolean;
    is_shortcut?: boolean;
    entry_type?: string;
  };
}

export const mapFolderEntry = (f: RawFolderEntry) => {
  const inner = f.FolderEntry;
  if (inner) {
    return {
      id: String(inner.id ?? ''),
      name: inner.name ?? '',
      document_id: inner.document_id ?? '',
      parent_id: inner.parent_id ? String(inner.parent_id) : '',
      created: inner.created ?? '',
      deleted: inner.deleted ?? null,
      is_project: inner.is_project ?? false,
      is_shortcut: inner.is_shortcut ?? false,
      entry_type: inner.entry_type ?? '',
    };
  }
  return {
    id: String(f.id ?? extractLastSegment(f.uri ?? '')),
    name: f.name ?? '',
    document_id: f.document ? extractDocId(f.document) : '',
    parent_id: f.parent ? extractLastSegment(f.parent) : '',
    created: f.created ?? '',
    deleted: f.deleted ?? null,
    is_project: f.isProject ?? false,
    is_shortcut: f.isShortcut ?? false,
    entry_type: f.entryType ?? '',
  };
};

// --- Document Status ---

export const documentStatusSchema = z.object({
  document_id: z.string().describe('Document UUID'),
  status_definition_id: z.number().int().describe('Status definition ID (0 = default)'),
  action_history_length: z.number().int().describe('Action history length'),
  created: z.string().describe('Timestamp when status was set'),
});

export interface RawDocumentStatus {
  documentId?: string;
  statusDefinitionId?: number;
  actionHistoryLength?: number;
  created?: number;
}

export const mapDocumentStatus = (s: RawDocumentStatus) => ({
  document_id: s.documentId ?? '',
  status_definition_id: s.statusDefinitionId ?? 0,
  action_history_length: s.actionHistoryLength ?? 0,
  created: s.created ? new Date(s.created).toISOString() : '',
});

// --- Helpers ---

const extractId = (uri: string): string => {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? '';
};

const extractDocId = (uri: string): string => {
  const match = uri.match(/documents\/([a-f0-9-]+)/);
  return match?.[1] ?? '';
};

const extractLastSegment = (uri: string): string => {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? '';
};
