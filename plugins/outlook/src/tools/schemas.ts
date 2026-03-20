import { z } from 'zod';

// ── User ────────────────────────────────────────────────────────────────

export const userSchema = z.object({
  id: z.string().describe('User ID'),
  display_name: z.string().describe('Display name'),
  email: z.string().describe('Email address'),
});

export interface RawUser {
  id?: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  emailAddress?: string; // Outlook REST API field (normalized from EmailAddress)
}

export const mapUser = (u: RawUser) => ({
  id: u.id ?? '',
  display_name: u.displayName ?? '',
  email: u.mail ?? u.emailAddress ?? u.userPrincipalName ?? '',
});

// ── Email Address ───────────────────────────────────────────────────────

export const emailAddressSchema = z.object({
  name: z.string().describe('Display name'),
  address: z.string().describe('Email address'),
});

export interface RawEmailAddress {
  emailAddress?: { name?: string; address?: string };
}

export const mapEmailAddress = (e: RawEmailAddress | undefined | null) => ({
  name: e?.emailAddress?.name ?? '',
  address: e?.emailAddress?.address ?? '',
});

// ── Message ─────────────────────────────────────────────────────────────

export const messageSummarySchema = z.object({
  id: z.string().describe('Message ID'),
  subject: z.string().describe('Subject line'),
  from: emailAddressSchema.describe('Sender'),
  to: z.array(emailAddressSchema).describe('To recipients'),
  received_at: z.string().describe('Received datetime (ISO 8601)'),
  is_read: z.boolean().describe('Whether the message has been read'),
  has_attachments: z.boolean().describe('Whether the message has attachments'),
  importance: z.string().describe('Importance level (low, normal, high)'),
  preview: z.string().describe('Body preview text'),
});

export const messageDetailSchema = messageSummarySchema.extend({
  cc: z.array(emailAddressSchema).describe('CC recipients'),
  bcc: z.array(emailAddressSchema).describe('BCC recipients'),
  body_type: z.string().describe('Body content type (text or html)'),
  body: z.string().describe('Full message body'),
  web_link: z.string().describe('Link to open in Outlook'),
  conversation_id: z.string().describe('Conversation thread ID'),
  categories: z.array(z.string()).describe('Categories/labels'),
  flag_status: z.string().describe('Flag status (notFlagged, flagged, complete)'),
});

export interface RawMessage {
  id?: string;
  subject?: string;
  from?: RawEmailAddress;
  toRecipients?: RawEmailAddress[];
  ccRecipients?: RawEmailAddress[];
  bccRecipients?: RawEmailAddress[];
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  importance?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  webLink?: string;
  conversationId?: string;
  categories?: string[];
  flag?: { flagStatus?: string };
}

export const mapMessageSummary = (m: RawMessage) => ({
  id: m.id ?? '',
  subject: m.subject ?? '(no subject)',
  from: mapEmailAddress(m.from ?? {}),
  to: (m.toRecipients ?? []).map(mapEmailAddress),
  received_at: m.receivedDateTime ?? '',
  is_read: m.isRead ?? false,
  has_attachments: m.hasAttachments ?? false,
  importance: m.importance ?? 'normal',
  preview: m.bodyPreview ?? '',
});

export const mapMessageDetail = (m: RawMessage) => ({
  ...mapMessageSummary(m),
  cc: (m.ccRecipients ?? []).map(mapEmailAddress),
  bcc: (m.bccRecipients ?? []).map(mapEmailAddress),
  body_type: m.body?.contentType ?? 'text',
  body: m.body?.content ?? '',
  web_link: m.webLink ?? '',
  conversation_id: m.conversationId ?? '',
  categories: m.categories ?? [],
  flag_status: m.flag?.flagStatus ?? 'notFlagged',
});

// ── Mail Folder ─────────────────────────────────────────────────────────

export const mailFolderSchema = z.object({
  id: z.string().describe('Folder ID'),
  display_name: z.string().describe('Folder display name'),
  parent_folder_id: z.string().describe('Parent folder ID'),
  child_folder_count: z.number().describe('Number of child folders'),
  unread_count: z.number().describe('Unread message count'),
  total_count: z.number().describe('Total message count'),
});

export interface RawMailFolder {
  id?: string;
  displayName?: string;
  parentFolderId?: string;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
}

export const mapMailFolder = (f: RawMailFolder) => ({
  id: f.id ?? '',
  display_name: f.displayName ?? '',
  parent_folder_id: f.parentFolderId ?? '',
  child_folder_count: f.childFolderCount ?? 0,
  unread_count: f.unreadItemCount ?? 0,
  total_count: f.totalItemCount ?? 0,
});

// ── Attachment ──────────────────────────────────────────────────────────

export const attachmentSchema = z.object({
  id: z.string().describe('Attachment ID'),
  name: z.string().describe('File name'),
  content_type: z.string().describe('MIME type'),
  size: z.number().describe('Size in bytes'),
  is_inline: z.boolean().describe('Whether the attachment is inline'),
});

export interface RawAttachment {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
}

export const mapAttachment = (a: RawAttachment) => ({
  id: a.id ?? '',
  name: a.name ?? '',
  content_type: a.contentType ?? '',
  size: a.size ?? 0,
  is_inline: a.isInline ?? false,
});

// ── Shared field lists for $select ──────────────────────────────────────

export const MESSAGE_SUMMARY_FIELDS =
  'id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance,bodyPreview';

export const MESSAGE_DETAIL_FIELDS =
  'id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,hasAttachments,importance,bodyPreview,body,webLink,conversationId,categories,flag';
