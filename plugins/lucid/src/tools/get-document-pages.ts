import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi } from '../lucid-api.js';
import { type RawPage, mapPage, pageSchema } from './schemas.js';

export const getDocumentPages = defineTool({
  name: 'get_document_pages',
  displayName: 'Get Document Pages',
  description: 'Get all pages in a Lucid document, including page titles, indices, and thumbnail URLs.',
  summary: 'List pages in a document',
  icon: 'layers',
  group: 'Documents',
  input: z.object({
    document_id: z.string().describe('Document UUID'),
  }),
  output: z.object({
    pages: z.array(pageSchema),
  }),
  handle: async params => {
    const data = await docsApi<RawPage[]>(`/documents/${params.document_id}/pages`);
    return { pages: data.map(mapPage) };
  },
});
