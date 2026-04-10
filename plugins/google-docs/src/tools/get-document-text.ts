import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchDocumentText } from '../document-text.js';
import { resolveDocumentId } from '../google-docs-api.js';

export const getDocumentText = defineTool({
  name: 'get_document_text',
  displayName: 'Get Document Text',
  description:
    'Get the plain-text content of a Google Doc. Fetches the latest saved document content from the server, including edits by other collaborators. Returns the full document text as paragraphs joined by newlines.',
  summary: 'Read the plain text of a document',
  icon: 'file-text',
  group: 'Documents',
  input: z.object({
    document_id: z
      .string()
      .optional()
      .describe('Google Docs document ID. Defaults to the document open in the current editor tab.'),
  }),
  output: z.object({
    document_id: z.string().describe('Google Docs document ID'),
    title: z.string().describe('Document title'),
    text: z.string().describe('Plain-text document content'),
  }),
  handle: async params => {
    const documentId = resolveDocumentId(params.document_id);
    const { text, title } = await fetchDocumentText(documentId);

    return {
      document_id: documentId,
      title,
      text: text ?? '',
    };
  },
});
