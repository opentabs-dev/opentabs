import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { docsApi } from '../lucid-api.js';

export const trashDocument = defineTool({
  name: 'trash_document',
  displayName: 'Trash Document',
  description: 'Move a Lucid document to the trash. The document can be restored later using restore_document.',
  summary: 'Move a document to trash',
  icon: 'trash-2',
  group: 'Documents',
  input: z.object({
    document_id: z.string().describe('Document UUID to trash'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
  }),
  handle: async params => {
    await docsApi(`/documents/${params.document_id}`, {
      method: 'PATCH',
      body: { deleted: new Date().toISOString() },
    });
    return { success: true };
  },
});
