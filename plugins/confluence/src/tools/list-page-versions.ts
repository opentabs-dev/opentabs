import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { cursorSchema, extractCursor } from './schemas.js';

const pageVersionSchema = z.object({
  number: z.number().describe('Version number'),
  message: z.string().describe('Version message describing the change'),
  created_at: z.string().describe('ISO 8601 timestamp of the version'),
  author_id: z.string().describe('Account ID of the version author'),
  minor_edit: z.boolean().describe('Whether this was a minor edit'),
});

interface RawPageVersion {
  number?: number;
  message?: string;
  createdAt?: string;
  authorId?: string;
  minorEdit?: boolean;
}

const mapPageVersion = (v: RawPageVersion) => ({
  number: v.number ?? 0,
  message: v.message ?? '',
  created_at: v.createdAt ?? '',
  author_id: v.authorId ?? '',
  minor_edit: v.minorEdit ?? false,
});

export const listPageVersions = defineTool({
  name: 'list_page_versions',
  displayName: 'List Page Versions',
  description: 'List version history of a Confluence page. Shows who edited the page and when.',
  summary: 'List page version history',
  icon: 'history',
  group: 'Pages',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to list versions for'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe('Maximum number of versions to return (default 25, max 250)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    versions: z.array(pageVersionSchema).describe('Array of page versions'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
    };
    if (params.cursor) query.cursor = params.cursor;

    const data = await apiV2<{
      results: RawPageVersion[];
      _links?: { next?: string };
    }>(`/pages/${params.page_id}/versions`, { query });

    return {
      versions: (data.results ?? []).map(mapPageVersion),
      cursor: extractCursor(data._links?.next),
    };
  },
});
