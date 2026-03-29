import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { attachmentSchema, mapAttachment, paginationSchema } from './schemas.js';

export const listAttachments = defineTool({
  name: 'list_attachments',
  displayName: 'List Attachments',
  description: 'List attachments (linked PRs, documents, URLs) on a Linear issue.',
  summary: 'List attachments on an issue',
  icon: 'paperclip',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to list attachments for'),
    limit: z.number().optional().describe('Maximum number of attachments to return (default 25, max 50)'),
    after: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    attachments: z.array(attachmentSchema).describe('List of attachments on the issue'),
    pagination: paginationSchema.describe('Pagination info for fetching more results'),
  }),
  handle: async params => {
    const limit = Math.min(params.limit ?? 25, 50);

    const data = await graphql<{
      issue: {
        attachments: {
          nodes: Record<string, unknown>[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
    }>(
      `query ListAttachments($id: String!, $first: Int, $after: String) {
        issue(id: $id) {
          attachments(first: $first, after: $after) {
            nodes {
              id title subtitle url sourceType createdAt updatedAt
              creator { name displayName }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: params.issue_id, first: limit, after: params.after },
    );

    if (!data.issue) throw ToolError.notFound('Issue not found');
    const result = data.issue.attachments;
    return {
      attachments: result.nodes.map(n => mapAttachment(n as Parameters<typeof mapAttachment>[0])),
      pagination: {
        has_next_page: result.pageInfo?.hasNextPage ?? false,
        end_cursor: result.pageInfo?.endCursor ?? '',
      },
    };
  },
});
