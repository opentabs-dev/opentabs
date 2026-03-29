import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { issueSchema, mapIssue } from './schemas.js';

export const setIssueCycle = defineTool({
  name: 'set_issue_cycle',
  displayName: 'Set Issue Cycle',
  description:
    'Assign an issue to a cycle (sprint). Use list_cycles to find cycle IDs. Pass an empty string to remove from the current cycle.',
  summary: 'Assign an issue to a cycle/sprint',
  icon: 'refresh-cw',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to update'),
    cycle_id: z.string().describe('Cycle UUID to assign to, or empty string to remove from cycle'),
  }),
  output: z.object({
    issue: issueSchema.describe('The updated issue'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {
      cycleId: params.cycle_id || null,
    };

    const data = await graphql<{
      issueUpdate: { success: boolean; issue: Record<string, unknown> };
    }>(
      `mutation SetIssueCycle($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id identifier title description priority priorityLabel url
            createdAt updatedAt dueDate estimate
            state { name type }
            assignee { name displayName }
            team { key name }
            labels { nodes { name } }
            project { name }
            cycle { number }
          }
        }
      }`,
      { id: params.issue_id, input },
    );

    if (!data.issueUpdate?.issue) throw ToolError.internal('Failed to set cycle — no issue returned');

    return { issue: mapIssue(data.issueUpdate.issue as Parameters<typeof mapIssue>[0]) };
  },
});
