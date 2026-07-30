import { ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import {
  attachFileToMessage,
  attachLargeFileToMessage,
  attachReferenceToMessage,
  uploadAttachmentToOneDrive,
} from './outlook-api.js';

/**
 * Adds attachments to draft messages the plugin creates. A file's bytes arrive as a
 * base64 string in the tool params — the plugin runs in the browser page context and
 * has no filesystem access, so a path on disk is not reachable. Each attachment is
 * either embedded as a copy of its bytes (a `fileAttachment`) or, when
 * `as_cloud_link` is set, uploaded to the user's OneDrive and attached as a sharing
 * link (a `referenceAttachment`).
 */

/**
 * Largest file embedded inline as base64 `contentBytes`. Microsoft rejects a single
 * attachment request over ~3 MB, so anything larger needs a chunked upload session.
 */
const INLINE_ATTACHMENT_LIMIT_BYTES = 3_000_000;

/** Shared input shape for one attachment, reused across every compose tool. */
export const attachmentInputSchema = z.object({
  name: z.string().min(1).describe('File name including extension, e.g. "report.pdf"'),
  content_base64: z
    .string()
    .min(1)
    .describe(
      'File content, base64-encoded. A data: URI prefix (e.g. "data:application/pdf;base64,") is accepted and stripped.',
    ),
  content_type: z.string().optional().describe('MIME type (default: application/octet-stream)'),
  as_cloud_link: z
    .boolean()
    .optional()
    .describe(
      'Attach as a OneDrive sharing link instead of embedding a copy of the file (default: false). Use for large files or documents recipients should open in the cloud.',
    ),
});

export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

/** Strip an optional `data:` URI prefix, returning the bare base64 payload. */
const stripDataUri = (value: string): string => {
  if (!value.startsWith('data:')) return value;
  const comma = value.indexOf(',');
  return comma === -1 ? value : value.slice(comma + 1);
};

/** Decode a base64 string to its raw bytes. */
const decodeBase64 = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Decoded byte length of a base64 string, computed without allocating the bytes. */
const base64ByteLength = (base64: string): number => {
  if (base64.length === 0) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};

/** Attach one file to a draft, dispatching on embed-vs-link and size. */
const attachOne = async (messageId: string, input: AttachmentInput): Promise<void> => {
  const contentBase64 = stripDataUri(input.content_base64.trim());
  if (contentBase64.length === 0) throw ToolError.validation(`Attachment "${input.name}" has no content.`);

  // A cloud link uploads the bytes to OneDrive and references the file by sharing link,
  // so it is not bound by the inline-embed size ceiling.
  if (input.as_cloud_link) {
    const bytes = decodeBase64(contentBase64);
    const sourceUrl = await uploadAttachmentToOneDrive(
      input.name,
      bytes,
      input.content_type ?? 'application/octet-stream',
    );
    await attachReferenceToMessage(messageId, { name: input.name, sourceUrl });
    return;
  }

  // A single inline request cannot carry more than ~3 MB of base64, so larger embeds
  // stream the raw bytes to the draft through a chunked upload session instead.
  if (base64ByteLength(contentBase64) > INLINE_ATTACHMENT_LIMIT_BYTES) {
    await attachLargeFileToMessage(messageId, {
      name: input.name,
      contentType: input.content_type,
      bytes: decodeBase64(contentBase64),
    });
    return;
  }

  await attachFileToMessage(messageId, {
    name: input.name,
    contentType: input.content_type,
    contentBase64,
  });
};

/**
 * Attach files to a draft message in order. Attachments are applied sequentially —
 * concurrent POSTs to the same message race on its change key — so a failure stops
 * the run and propagates, leaving the draft with whatever attached before it.
 */
export const attachToDraft = async (messageId: string, attachments: AttachmentInput[] | undefined): Promise<void> => {
  if (!attachments || attachments.length === 0) return;
  for (const attachment of attachments) {
    await attachOne(messageId, attachment);
  }
};
