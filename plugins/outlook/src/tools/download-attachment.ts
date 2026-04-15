import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import type { RawAttachmentContent } from './schemas.js';

/**
 * Convert a base64 string to a Uint8Array.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Trigger a browser download for the given bytes, saving as the specified filename.
 * Uses the standard <a download> pattern which saves to the user's Downloads folder.
 */
function triggerBrowserDownload(bytes: Uint8Array, filename: string, mimeType: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const downloadAttachment = defineTool({
  name: 'download_attachment',
  displayName: 'Download Attachment',
  description:
    'Download an email attachment to the local filesystem (browser Downloads folder). Works with any file type — Excel, PDF, images, Word documents, etc. Returns the filename so you can locate it in the Downloads folder.',
  summary: 'Save attachment to Downloads folder',
  icon: 'download',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID'),
    attachment_id: z.string().describe('The attachment ID (from list_attachments)'),
  }),
  output: z.object({
    name: z.string().describe('Downloaded file name'),
    content_type: z.string().describe('MIME type'),
    size: z.number().describe('Size in bytes'),
    downloaded: z.boolean().describe('Whether the download was triggered successfully'),
  }),
  handle: async params => {
    const data = await api<RawAttachmentContent>(
      `/me/messages/${params.message_id}/attachments/${params.attachment_id}`,
      {
        query: { $select: 'id,name,contentType,size,isInline,contentBytes' },
      },
    );

    const name = data.name ?? 'attachment';
    const contentType = data.contentType ?? 'application/octet-stream';
    const size = data.size ?? 0;
    const contentBytes = data.contentBytes ?? '';

    if (!contentBytes) {
      return { name, content_type: contentType, size, downloaded: false };
    }

    const bytes = base64ToBytes(contentBytes);
    triggerBrowserDownload(bytes, name, contentType);

    return { name, content_type: contentType, size, downloaded: true };
  },
});
