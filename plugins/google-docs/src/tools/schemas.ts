import { z } from 'zod';

export const DOCUMENT_MIME_TYPE = 'application/vnd.google-apps.document';

export const DOCUMENT_FIELDS =
  'id,name,mimeType,modifiedTime,createdTime,trashed,starred,shared,ownedByMe,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress)';

export const DOCUMENT_LIST_FIELDS = `nextPageToken,files(${DOCUMENT_FIELDS})`;

export interface RawUser {
  displayName?: string;
  emailAddress?: string;
  permissionId?: string;
  photoLink?: string;
}

export interface RawDriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  trashed?: boolean;
  starred?: boolean;
  shared?: boolean;
  ownedByMe?: boolean;
  webViewLink?: string;
  owners?: RawUser[];
  lastModifyingUser?: RawUser;
}

export interface RawAbout {
  user?: RawUser;
  storageQuota?: {
    limit?: string;
    usage?: string;
    usageInDrive?: string;
    usageInDriveTrash?: string;
  };
}

export interface NormalizedDocumentTab {
  id: string;
  title: string;
  index: number;
  parentId: string;
}

export const userSchema = z.object({
  display_name: z.string().describe('User display name'),
  email: z.string().describe('User email address'),
  permission_id: z.string().describe('Drive permission ID for the current user'),
  photo_link: z.string().describe('URL to the user profile photo'),
});

export const storageQuotaSchema = z.object({
  limit_bytes: z.string().describe('Total storage limit in bytes'),
  usage_bytes: z.string().describe('Total storage usage in bytes'),
  usage_in_drive_bytes: z.string().describe('Storage used by Drive files in bytes'),
  usage_in_trash_bytes: z.string().describe('Storage used by trashed Drive files in bytes'),
});

export const documentSchema = z.object({
  id: z.string().describe('Google Docs document ID'),
  title: z.string().describe('Document title'),
  mime_type: z.string().describe('Document MIME type'),
  created_time: z.string().describe('Creation time in ISO 8601 format'),
  modified_time: z.string().describe('Last modified time in ISO 8601 format'),
  trashed: z.boolean().describe('Whether the document is in the trash'),
  starred: z.boolean().describe('Whether the document is starred'),
  shared: z.boolean().describe('Whether the document is shared'),
  owned_by_me: z.boolean().describe('Whether the authenticated user owns the document'),
  web_view_link: z.string().describe('Browser URL for opening the document'),
  owner: z.string().describe('Primary owner display name'),
  owner_email: z.string().describe('Primary owner email address'),
  last_modified_by: z.string().describe('Display name of the last modifying user'),
});

export const tabSchema = z.object({
  id: z.string().describe('Google Docs tab ID. Empty for single-body documents without explicit tabs.'),
  title: z.string().describe('Tab title'),
  index: z.number().int().describe('Zero-based tab order'),
  parent_id: z.string().describe('Parent tab ID, empty for top-level tabs'),
  is_current_tab: z.boolean().describe('Whether this tab is the active tab for the current result'),
});

export interface RawCommentAuthor {
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
}

export interface RawReply {
  id?: string;
  author?: RawCommentAuthor;
  content?: string;
  createdTime?: string;
  modifiedTime?: string;
  action?: string;
}

export interface RawQuotedFileContent {
  mimeType?: string;
  value?: string;
}

export interface RawComment {
  id?: string;
  author?: RawCommentAuthor;
  content?: string;
  createdTime?: string;
  modifiedTime?: string;
  resolved?: boolean;
  quotedFileContent?: RawQuotedFileContent;
  anchor?: string;
  replies?: RawReply[];
}

export const COMMENT_FIELDS =
  'id,author(displayName,emailAddress,photoLink),content,createdTime,modifiedTime,resolved,quotedFileContent(mimeType,value),anchor,replies(id,author(displayName,emailAddress,photoLink),content,createdTime,modifiedTime,action)';

export const COMMENT_LIST_FIELDS = `nextPageToken,comments(${COMMENT_FIELDS})`;

export const replySchema = z.object({
  id: z.string().describe('Reply ID'),
  author: z.string().describe('Reply author display name'),
  author_email: z.string().describe('Reply author email address'),
  content: z.string().describe('Reply text content'),
  created_time: z.string().describe('Reply creation time in ISO 8601 format'),
  modified_time: z.string().describe('Reply last modified time in ISO 8601 format'),
  action: z.string().describe('Reply action: "reopen" or "resolve", empty for regular replies'),
});

export const commentSchema = z.object({
  id: z.string().describe('Comment ID'),
  author: z.string().describe('Comment author display name'),
  author_email: z.string().describe('Comment author email address'),
  content: z.string().describe('Comment text content'),
  created_time: z.string().describe('Comment creation time in ISO 8601 format'),
  modified_time: z.string().describe('Comment last modified time in ISO 8601 format'),
  resolved: z
    .boolean()
    .describe('Whether the comment thread is resolved (closed). Resolved threads no longer need attention.'),
  quoted_text: z.string().describe('The document text this comment is anchored to'),
  anchor: z.string().describe('Named range ID (kix.*) that positions this comment in the document'),
  replies: z.array(replySchema).describe('Replies in this comment thread'),
});

export const mapUser = (user: RawUser) => ({
  display_name: user.displayName ?? '',
  email: user.emailAddress ?? '',
  permission_id: user.permissionId ?? '',
  photo_link: user.photoLink ?? '',
});

export const mapStorageQuota = (quota: NonNullable<RawAbout['storageQuota']>) => ({
  limit_bytes: quota.limit ?? '0',
  usage_bytes: quota.usage ?? '0',
  usage_in_drive_bytes: quota.usageInDrive ?? '0',
  usage_in_trash_bytes: quota.usageInDriveTrash ?? '0',
});

export const mapDocument = (file: RawDriveFile) => ({
  id: file.id ?? '',
  title: file.name ?? '',
  mime_type: file.mimeType ?? '',
  created_time: file.createdTime ?? '',
  modified_time: file.modifiedTime ?? '',
  trashed: file.trashed ?? false,
  starred: file.starred ?? false,
  shared: file.shared ?? false,
  owned_by_me: file.ownedByMe ?? false,
  web_view_link: file.webViewLink ?? '',
  owner: file.owners?.[0]?.displayName ?? '',
  owner_email: file.owners?.[0]?.emailAddress ?? '',
  last_modified_by: file.lastModifyingUser?.displayName ?? '',
});

export const mapTab = (tab: NormalizedDocumentTab, activeTabId: string) => ({
  id: tab.id,
  title: tab.title,
  index: tab.index,
  parent_id: tab.parentId,
  is_current_tab: tab.id === activeTabId || (activeTabId === '' && tab.id === ''),
});

export const mapReply = (reply: RawReply) => ({
  id: reply.id ?? '',
  author: reply.author?.displayName ?? '',
  author_email: reply.author?.emailAddress ?? '',
  content: reply.content ?? '',
  created_time: reply.createdTime ?? '',
  modified_time: reply.modifiedTime ?? '',
  action: reply.action ?? '',
});

export const mapComment = (comment: RawComment) => ({
  id: comment.id ?? '',
  author: comment.author?.displayName ?? '',
  author_email: comment.author?.emailAddress ?? '',
  content: comment.content ?? '',
  created_time: comment.createdTime ?? '',
  modified_time: comment.modifiedTime ?? '',
  resolved: comment.resolved ?? false,
  quoted_text: comment.quotedFileContent?.value ?? '',
  anchor: comment.anchor ?? '',
  replies: (comment.replies ?? []).map(mapReply),
});

export const escapeDriveQueryValue = (value: string): string => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
