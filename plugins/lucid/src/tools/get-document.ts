import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi } from '../lucid-api.js';
import { type RawDocument, mapDocument, documentSchema } from './schemas.js';

export const getDocument = defineTool({
  name: 'get_document',
  displayName: 'Get Document',
  description:
    'Get detailed information about a specific Lucid document by its UUID, including title, product type, timestamps, size, and edit URL.',
  summary: 'Get document details',
  icon: 'file-text',
  group: 'Documents',
  input: z.object({
    document_id: z.string().describe('Document UUID'),
  }),
  output: z.object({ document: documentSchema }),
  handle: async params => {
    const data = await docsApi<RawDocument>(`/documents/${params.document_id}`);
    return { document: mapDocument(data) };
  },
});
