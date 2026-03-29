import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { documentSchema, mapDocument } from './schemas.js';

export const updateDocument = defineTool({
  name: 'update_document',
  displayName: 'Update Document',
  description: 'Update an existing Linear document. Only specified fields are changed.',
  summary: 'Update an existing document',
  icon: 'file-edit',
  group: 'Documents',
  input: z.object({
    document_id: z.string().describe('Document UUID to update'),
    title: z.string().optional().describe('New document title'),
    content: z.string().optional().describe('New document content in markdown'),
    project_id: z.string().optional().describe('Move to this project UUID'),
    icon: z.string().optional().describe('New icon emoji'),
  }),
  output: z.object({
    document: documentSchema.describe('The updated document'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {};
    if (params.title !== undefined) input.title = params.title;
    if (params.content !== undefined) input.content = params.content;
    if (params.project_id !== undefined) input.projectId = params.project_id;
    if (params.icon !== undefined) input.icon = params.icon;

    const data = await graphql<{
      documentUpdate: {
        success: boolean;
        document: Record<string, unknown>;
      };
    }>(
      `mutation UpdateDocument($id: String!, $input: DocumentUpdateInput!) {
        documentUpdate(id: $id, input: $input) {
          success
          document {
            id title content slugId icon url createdAt updatedAt
            creator { name displayName }
            project { name }
          }
        }
      }`,
      { id: params.document_id, input },
    );

    if (!data.documentUpdate?.document) throw ToolError.internal('Document update failed — no document returned');

    return { document: mapDocument(data.documentUpdate.document as Parameters<typeof mapDocument>[0]) };
  },
});
