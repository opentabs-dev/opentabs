import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../google-drive-api.js';
import { type RawFile, FILE_LIST_FIELDS, fileSchema, mapFile } from './schemas.js';

export const searchFiles = defineTool({
  name: 'search_files',
  displayName: 'Search Files',
  description:
    'Search for files and folders in Google Drive by name or full-text content. The query searches file names and document content. Use mime_type to filter by type (e.g., "application/vnd.google-apps.folder" for folders, "application/vnd.google-apps.document" for Docs, "application/vnd.google-apps.spreadsheet" for Sheets). Trashed files are excluded by default.',
  summary: 'Search files by name or content',
  icon: 'search',
  group: 'Files',
  input: z.object({
    query: z.string().describe('Search text to match against file names and content'),
    mime_type: z
      .string()
      .optional()
      .describe(
        'Filter by MIME type (e.g., "application/vnd.google-apps.folder", "application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet", "application/pdf")',
      ),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('Maximum number of results (default 20, max 1000)'),
    page_token: z.string().optional().describe('Page token for pagination'),
    include_trashed: z.boolean().optional().describe('Include trashed files (default false)'),
  }),
  output: z.object({
    files: z.array(fileSchema).describe('Matching files and folders'),
    next_page_token: z.string().describe('Token for the next page, empty if no more results'),
  }),
  handle: async params => {
    const clauses: string[] = [`fullText contains '${params.query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`];
    if (params.mime_type) clauses.push(`mimeType = '${params.mime_type}'`);
    if (!params.include_trashed) clauses.push('trashed = false');

    const data = await api<{ nextPageToken?: string; files?: RawFile[] }>('/files', {
      params: {
        q: clauses.join(' and '),
        pageSize: params.page_size ?? 20,
        pageToken: params.page_token,
        fields: FILE_LIST_FIELDS,
      },
    });

    return {
      files: (data.files ?? []).map(mapFile),
      next_page_token: data.nextPageToken ?? '',
    };
  },
});
