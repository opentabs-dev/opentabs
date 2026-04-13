import { defineTool, ToolError, fetchFromPage } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getUserId } from '../lucid-api.js';

export const getDocumentRole = defineTool({
  name: 'get_document_role',
  displayName: 'Get Document Role',
  description:
    'Get the current user\'s access role on a specific document. Returns roles like "owner", "editor", or "viewer".',
  summary: 'Get your role on a document',
  icon: 'user-check',
  group: 'Documents',
  input: z.object({
    document_id: z.string().describe('Document UUID'),
  }),
  output: z.object({
    role: z.string().describe('User role on the document (e.g., "owner", "editor", "viewer")'),
  }),
  handle: async params => {
    getUserId(); // ensure authenticated
    const url = `https://documents.lucid.app/documents/${params.document_id}/role`;
    const response = await fetchFromPage(url, {
      headers: { Accept: 'application/json' },
    });
    const text = await response.text();
    // API returns a JSON-quoted string like "owner" or plain text
    const role = text.startsWith('"') ? JSON.parse(text) : text;
    if (!role || typeof role !== 'string') {
      throw ToolError.internal('Unexpected role response format');
    }
    return { role };
  },
});
