import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const createIssueRelation = defineTool({
  name: 'create_issue_relation',
  displayName: 'Create Issue Relation',
  description: 'Create a relation between two Linear issues (blocks, is blocked by, relates to, or duplicate of).',
  summary: 'Create a relation between two issues',
  icon: 'link',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('UUID of the source issue'),
    related_issue_id: z.string().describe('UUID of the target issue to relate to'),
    type: z
      .enum(['blocks', 'blockedBy', 'related', 'duplicate'])
      .describe('Relation type: blocks, blockedBy, related, or duplicate'),
  }),
  output: z.object({
    relation: z.object({
      id: z.string().describe('Relation UUID'),
      type: z.string().describe('Relation type'),
      related_issue_identifier: z.string().describe('Related issue identifier (e.g. ENG-123)'),
    }),
  }),
  handle: async params => {
    const data = await graphql<{
      issueRelationCreate: {
        success: boolean;
        issueRelation: {
          id?: string;
          type?: string;
          relatedIssue?: { identifier?: string };
        };
      };
    }>(
      `mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
        issueRelationCreate(input: $input) {
          success
          issueRelation {
            id type
            relatedIssue { identifier }
          }
        }
      }`,
      {
        input: {
          issueId: params.issue_id,
          relatedIssueId: params.related_issue_id,
          type: params.type,
        },
      },
    );

    if (!data.issueRelationCreate?.issueRelation)
      throw ToolError.internal('Issue relation creation failed — no relation returned');

    const rel = data.issueRelationCreate.issueRelation;
    return {
      relation: {
        id: rel.id ?? '',
        type: rel.type ?? '',
        related_issue_identifier: rel.relatedIssue?.identifier ?? '',
      },
    };
  },
});
