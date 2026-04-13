import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi, getUserId } from '../lucid-api.js';
import { type RawDocument, mapDocument, documentSchema } from './schemas.js';

export const listDocuments = defineTool({
  name: 'list_documents',
  displayName: 'List Documents',
  description:
    'List documents for the current user. Filter by product type (chart for Lucidchart, press for Lucidspark, spark for Lucidscale). Optionally search by text query.',
  summary: 'List your documents',
  icon: 'file-text',
  group: 'Documents',
  input: z.object({
    product: z.enum(['chart', 'press', 'spark']).optional().describe('Product type to filter by (default: chart)'),
    search: z.string().optional().describe('Search query to filter documents by title'),
  }),
  output: z.object({
    documents: z.array(documentSchema),
  }),
  handle: async params => {
    const userId = getUserId();
    const product = params.product ?? 'chart';
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params.search) query.search = params.search;
    const data = await docsApi<RawDocument[]>(`/users/${userId}/documents/${product}`, { query });
    return { documents: data.map(mapDocument) };
  },
});
