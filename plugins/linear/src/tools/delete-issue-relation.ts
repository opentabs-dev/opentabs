import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const deleteIssueRelation = defineTool({
  name: 'delete_issue_relation',
  displayName: 'Delete Issue Relation',
  description: 'Delete a relation between two Linear issues. Use list_issue_relations to find relation IDs.',
  summary: 'Delete a relation between two issues',
  icon: 'unlink',
  group: 'Issues',
  input: z.object({
    relation_id: z.string().describe('Relation UUID to delete (from list_issue_relations)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the relation was successfully deleted'),
  }),
  handle: async params => {
    const data = await graphql<{
      issueRelationDelete: { success: boolean };
    }>(
      `mutation DeleteIssueRelation($id: String!) {
        issueRelationDelete(id: $id) {
          success
        }
      }`,
      { id: params.relation_id },
    );

    if (!data.issueRelationDelete) throw ToolError.internal('Issue relation deletion failed — no response');

    return { success: data.issueRelationDelete.success };
  },
});
