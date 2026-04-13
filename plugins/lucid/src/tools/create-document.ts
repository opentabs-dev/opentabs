import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi } from '../lucid-api.js';
import { type RawDocument, mapDocument, documentSchema } from './schemas.js';

export const createDocument = defineTool({
  name: 'create_document',
  displayName: 'Create Document',
  description:
    'Create a new blank Lucid document. Specify a title and product type (chart for Lucidchart diagram, press for Lucidspark whiteboard). Returns the created document with its edit URL.',
  summary: 'Create a new document',
  icon: 'file-plus',
  group: 'Documents',
  input: z.object({
    title: z.string().describe('Document title'),
    product: z
      .enum(['chart', 'press'])
      .optional()
      .describe('Product type: chart (Lucidchart) or press (Lucidspark). Default: chart'),
  }),
  output: z.object({ document: documentSchema }),
  handle: async params => {
    const product = params.product ?? 'chart';
    const data = await docsApi<RawDocument>('/documents', {
      method: 'POST',
      body: { title: params.title, product },
    });
    return { document: mapDocument(data) };
  },
});
