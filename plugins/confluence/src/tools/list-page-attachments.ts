import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { cursorSchema, extractCursor } from './schemas.js';

const attachmentSchema = z.object({
  id: z.string().describe('Attachment ID'),
  title: z.string().describe('Filename of the attachment'),
  media_type: z.string().describe('MIME type (e.g., "image/png", "application/pdf")'),
  file_size: z.number().describe('File size in bytes'),
  download_url: z.string().describe('Relative download URL for the attachment'),
});

interface RawAttachment {
  id?: string;
  title?: string;
  mediaType?: string;
  fileSize?: number;
  downloadLink?: string;
  _links?: {
    download?: string;
  };
}

const mapAttachment = (a: RawAttachment) => ({
  id: a.id ?? '',
  title: a.title ?? '',
  media_type: a.mediaType ?? '',
  file_size: a.fileSize ?? 0,
  download_url: a._links?.download ?? a.downloadLink ?? '',
});

export const listPageAttachments = defineTool({
  name: 'list_page_attachments',
  displayName: 'List Page Attachments',
  description: 'List attachments on a Confluence page. Returns file names, sizes, and download URLs.',
  summary: 'List attachments on a page',
  icon: 'paperclip',
  group: 'Pages',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to list attachments for'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe('Maximum number of attachments to return (default 25, max 250)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    attachments: z.array(attachmentSchema).describe('Array of attachments'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
    };
    if (params.cursor) query.cursor = params.cursor;

    const data = await apiV2<{
      results: RawAttachment[];
      _links?: { next?: string };
    }>(`/pages/${params.page_id}/attachments`, { query });

    return {
      attachments: (data.results ?? []).map(mapAttachment),
      cursor: extractCursor(data._links?.next),
    };
  },
});
