import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docListApi, getUserId } from '../lucid-api.js';
import { type RawDocumentListItem, mapDocumentListItem, documentListItemSchema } from './schemas.js';

interface RawDocListResponse {
  documents?: RawDocumentListItem[];
}

export const searchDocuments = defineTool({
  name: 'search_documents',
  displayName: 'Search Documents',
  description:
    'Search across all Lucid documents by title or content. Returns rich document metadata including creator, starred status, and project membership. Use count to limit results.',
  summary: 'Search documents by keyword',
  icon: 'search',
  group: 'Documents',
  input: z.object({
    query: z.string().describe('Search query text'),
    count: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of results to return (default 20, max 100)'),
    product: z.enum(['chart', 'press', 'spark']).optional().describe('Filter by product type'),
  }),
  output: z.object({
    documents: z.array(documentListItemSchema),
  }),
  handle: async params => {
    const userId = getUserId();
    const count = params.count ?? 20;
    const query: Record<string, string | number | boolean | undefined> = {
      search: params.query,
      count,
    };
    if (params.product) query.product = params.product;
    const data = await docListApi<RawDocListResponse>(`/users/${userId}/documentList`, { query });
    return { documents: (data.documents ?? []).map(mapDocumentListItem) };
  },
});
