import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { documentSchema, mapDocument } from './schemas.js';

export const createDocument = defineTool({
  name: 'create_document',
  displayName: 'Create Document',
  description: 'Create a new document in Linear, optionally associated with a project.',
  summary: 'Create a new document',
  icon: 'file-plus',
  group: 'Documents',
  input: z.object({
    title: z.string().describe('Document title'),
    content: z.string().optional().describe('Document content in markdown'),
    project_id: z.string().optional().describe('Project UUID to associate the document with'),
    icon: z.string().optional().describe('Icon emoji for the document'),
  }),
  output: z.object({
    document: documentSchema.describe('The newly created document'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {
      title: params.title,
    };
    if (params.content !== undefined) input.content = params.content;
    if (params.project_id) input.projectId = params.project_id;
    if (params.icon) input.icon = params.icon;

    const data = await graphql<{
      documentCreate: {
        success: boolean;
        document: Record<string, unknown>;
      };
    }>(
      `mutation CreateDocument($input: DocumentCreateInput!) {
        documentCreate(input: $input) {
          success
          document {
            id title content slugId icon url createdAt updatedAt
            creator { name displayName }
            project { name }
          }
        }
      }`,
      { input },
    );

    if (!data.documentCreate?.document) throw ToolError.internal('Document creation failed — no document returned');

    return { document: mapDocument(data.documentCreate.document as Parameters<typeof mapDocument>[0]) };
  },
});
