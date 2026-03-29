import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { documentSchema, mapDocument } from './schemas.js';

export const getDocument = defineTool({
  name: 'get_document',
  displayName: 'Get Document',
  description: 'Get detailed information about a single Linear document by its UUID.',
  summary: 'Get details of a single document',
  icon: 'file-text',
  group: 'Documents',
  input: z.object({
    document_id: z.string().describe('Document UUID'),
  }),
  output: z.object({
    document: documentSchema.describe('The requested document'),
  }),
  handle: async params => {
    const data = await graphql<{ document: Record<string, unknown> }>(
      `query GetDocument($id: String!) {
        document(id: $id) {
          id title content slugId icon url createdAt updatedAt
          creator { name displayName }
          project { name }
        }
      }`,
      { id: params.document_id },
    );

    if (!data.document) throw ToolError.notFound('Document not found');

    return { document: mapDocument(data.document as Parameters<typeof mapDocument>[0]) };
  },
});
