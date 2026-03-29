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
  labels { nodes { name } }
  project { name }
  cycle { number }
`;

export const batchUpdateIssues = defineTool({
  name: 'batch_update_issues',
  displayName: 'Batch Update Issues',
  description:
    'Apply the same update to multiple issues at once. All specified fields are applied to every issue in the batch. Maximum 25 issues per call.',
  summary: 'Update multiple issues at once',
  icon: 'layers',
  group: 'Issues',
  input: z.object({
    issue_ids: z.array(z.string()).min(1).max(25).describe('Array of issue UUIDs to update (1–25)'),
    state_id: z.string().optional().describe('New workflow state UUID'),
    assignee_id: z.string().optional().describe('New assignee UUID'),
    priority: z.number().optional().describe('New priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)'),
    project_id: z.string().optional().describe('Move to this project UUID'),
    cycle_id: z.string().optional().describe('Assign to this cycle UUID'),
    label_ids: z.array(z.string()).optional().describe('Replace labels with these label UUIDs'),
    due_date: z.string().optional().describe('New due date in YYYY-MM-DD format'),
  }),
  output: z.object({
    issues: z.array(issueSchema).describe('The updated issues'),
    failed: z.array(z.string()).describe('Issue UUIDs that failed to update'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {};
    if (params.state_id !== undefined) input.stateId = params.state_id;
    if (params.assignee_id !== undefined) input.assigneeId = params.assignee_id;
    if (params.priority !== undefined) input.priority = params.priority;
    if (params.project_id !== undefined) input.projectId = params.project_id;
    if (params.cycle_id !== undefined) input.cycleId = params.cycle_id;
    if (params.label_ids !== undefined) input.labelIds = params.label_ids;
    if (params.due_date !== undefined) input.dueDate = params.due_date;

    if (Object.keys(input).length === 0) {
      throw ToolError.validation('No update fields specified — provide at least one field to update');
    }

    // Build aliased mutations for batch execution in a single GraphQL request
    const aliases = params.issue_ids.map(
      (id, i) =>
        `issue${i}: issueUpdate(id: "${id}", input: $input) {
        success
        issue { ${ISSUE_FIELDS} }
      }`,
    );

    const query = `mutation BatchUpdateIssues($input: IssueUpdateInput!) {
      ${aliases.join('\n')}
    }`;

    const data = await graphql<Record<string, { success: boolean; issue: Record<string, unknown> }>>(query, { input });

    const issues: ReturnType<typeof mapIssue>[] = [];
    const failed: string[] = [];

    for (let i = 0; i < params.issue_ids.length; i++) {
      const result = data[`issue${i}`];
      if (result?.success && result.issue) {
        issues.push(mapIssue(result.issue as Parameters<typeof mapIssue>[0]));
      } else {
        const issueId = params.issue_ids[i];
        if (issueId) failed.push(issueId);
      }
    }

    return { issues, failed };
  },
});
