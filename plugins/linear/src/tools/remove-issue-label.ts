import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { issueSchema, mapIssue } from './schemas.js';

const ISSUE_FIELDS = `
  id identifier title description priority priorityLabel url
  createdAt updatedAt dueDate estimate
  state { name type }
  assignee { name displayName }
  team { key name }
  labels { nodes { id name } }
  project { name }
  cycle { number }
`;

export const removeIssueLabel = defineTool({
  name: 'remove_issue_label',
  displayName: 'Remove Issue Label',
  description:
    'Remove a label from an issue without affecting other labels. Unlike update_issue which replaces all labels, this removes only the specified one.',
  summary: 'Remove a label from an issue',
  icon: 'tag',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to remove the label from'),
    label_id: z.string().describe('Label UUID to remove (use list_labels to find label IDs)'),
  }),
  output: z.object({
    issue: issueSchema.describe('The updated issue with the label removed'),
  }),
  handle: async params => {
    // Fetch current label IDs
    const current = await graphql<{
      issue: { labels: { nodes: Array<{ id: string }> } };
    }>(
      `query GetIssueLabels($id: String!) {
        issue(id: $id) {
          labels { nodes { id } }
        }
      }`,
      { id: params.issue_id },
    );

    if (!current.issue) throw ToolError.notFound('Issue not found');

    const existingIds = (current.issue.labels?.nodes ?? []).map(l => l.id);
    const labelIds = existingIds.filter(id => id !== params.label_id);

    if (labelIds.length === existingIds.length) {
      // Label was not present — just return the issue
      const data = await graphql<{ issue: Record<string, unknown> }>(
        `query GetIssue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
        { id: params.issue_id },
      );
      return { issue: mapIssue(data.issue as Parameters<typeof mapIssue>[0]) };
    }

    const data = await graphql<{
      issueUpdate: { success: boolean; issue: Record<string, unknown> };
    }>(
      `mutation RemoveIssueLabel($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { ${ISSUE_FIELDS} }
        }
      }`,
      { id: params.issue_id, input: { labelIds } },
    );

    if (!data.issueUpdate?.issue) throw ToolError.internal('Failed to remove label — no issue returned');

    return { issue: mapIssue(data.issueUpdate.issue as Parameters<typeof mapIssue>[0]) };
  },
});
