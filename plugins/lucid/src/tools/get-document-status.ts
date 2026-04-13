import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi } from '../lucid-api.js';
import { type RawDocumentStatus, mapDocumentStatus, documentStatusSchema } from './schemas.js';

export const getDocumentStatus = defineTool({
  name: 'get_document_status',
  displayName: 'Get Document Status',
  description:
    'Get the workflow status of a Lucid document, including the status definition and action history length.',
  summary: 'Get document workflow status',
  icon: 'activity',
  group: 'Documents',
  input: z.object({
    document_id: z.string().describe('Document UUID'),
  }),
  output: z.object({ status: documentStatusSchema }),
  handle: async params => {
    const data = await docsApi<RawDocumentStatus>(`/documents/${params.document_id}/status`);
    return { status: mapDocumentStatus(data) };
  },
});
