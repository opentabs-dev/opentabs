import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

interface RawAttachmentContent {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
}

export const getAttachmentContent = defineTool({
  name: 'get_attachment_content',
  displayName: 'Get Attachment Content',
  description:
    'Download and read the content of an email attachment. For text-based files (plain text, CSV, HTML, JSON, XML), returns decoded text. For binary files (PDF, images, Office documents), returns base64-encoded content.',
  summary: 'Get attachment content',
  icon: 'file-down',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID'),
    attachment_id: z.string().describe('The attachment ID (from list_attachments)'),
  }),
  output: z.object({
    name: z.string().describe('File name'),
    content_type: z.string().describe('MIME type'),
    size: z.number().describe('Size in bytes'),
    encoding: z.enum(['text', 'base64']).describe('Content encoding — text for readable files, base64 for binary'),
    content: z.string().describe('File content (decoded text or base64 string)'),
  }),
  handle: async params => {
    const data = await api<RawAttachmentContent>(
      `/me/messages/${params.message_id}/attachments/${params.attachment_id}`,
      {
        query: { $select: 'id,name,contentType,size,isInline,contentBytes' },
      },
    );

    const name = data.name ?? '';
    const contentType = data.contentType ?? 'application/octet-stream';
    const size = data.size ?? 0;
    const contentBytes = data.contentBytes ?? '';

    // Determine if this is a text-based file we can decode
    const isText =
      contentType.startsWith('text/') ||
      contentType === 'application/json' ||
      contentType === 'application/xml' ||
      contentType === 'application/csv' ||
      name.endsWith('.csv') ||
      name.endsWith('.json') ||
      name.endsWith('.xml') ||
      name.endsWith('.txt') ||
      name.endsWith('.md') ||
      name.endsWith('.html') ||
      name.endsWith('.htm');

    let content: string;
    let encoding: 'text' | 'base64';

    if (isText && contentBytes) {
      content = atob(contentBytes);
      encoding = 'text';
    } else {
      content = contentBytes;
      encoding = 'base64';
    }

    return { name, content_type: contentType, size, encoding, content };
  },
});
