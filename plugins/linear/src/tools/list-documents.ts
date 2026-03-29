import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { documentSchema, mapDocument, paginationSchema } from './schemas.js';

export const listDocuments = defineTool({
  name: 'list_documents',
  displayName: 'List Documents',
  description: 'List documents in the Linear workspace, optionally filtered by project.',
  summary: 'List documents',
  icon: 'file-text',
  group: 'Documents',
  input: z.object({
    project_id: z.string().optional().describe('Filter by project UUID'),
    limit: z.number().optional().describe('Maximum number of results to return (default 25, max 50)'),
    after: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    documents: z.array(documentSchema).describe('List of documents'),
    pagination: paginationSchema.describe('Pagination info for fetching more results'),
  }),
  handle: async params => {
    const limit = Math.min(params.limit ?? 25, 50);

    const filter: Record<string, unknown> = {};
    if (params.project_id) filter.project = { id: { eq: params.project_id } };
    const filterArg = Object.keys(filter).length > 0 ? filter : undefined;

    const data = await graphql<{
      documents: {
        nodes: Record<string, unknown>[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    }>(
      `query ListDocuments($first: Int, $after: String, $filter: DocumentFilter) {
        documents(first: $first, after: $after, filter: $filter) {
          nodes {
            id title content slugId icon url createdAt updatedAt
            creator { name displayName }
            project { name }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { first: limit, after: params.after, filter: filterArg },
    );

    if (!data.documents) throw ToolError.internal('Failed to list documents');
    const result = data.documents;
    return {
      documents: result.nodes.map(n => mapDocument(n as Parameters<typeof mapDocument>[0])),
      pagination: {
        has_next_page: result.pageInfo?.hasNextPage ?? false,
        end_cursor: result.pageInfo?.endCursor ?? '',
      },
    };
  },
});
