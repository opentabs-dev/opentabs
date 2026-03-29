import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { issueSchema, mapIssue } from './schemas.js';

export const moveIssueToProject = defineTool({
  name: 'move_issue_to_project',
  displayName: 'Move Issue to Project',
  description:
    'Move an issue to a different project. Use list_projects to find project IDs. Pass an empty string to remove from the current project.',
  summary: 'Move an issue between projects',
  icon: 'folder-input',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to move'),
    project_id: z.string().describe('Target project UUID, or empty string to remove from project'),
  }),
  output: z.object({
    issue: issueSchema.describe('The updated issue'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {
      projectId: params.project_id || null,
    };

    const data = await graphql<{
      issueUpdate: { success: boolean; issue: Record<string, unknown> };
    }>(
      `mutation MoveIssueToProject($id: String!, $input: IssueUpdateInput!) {
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

    if (!data.issueUpdate?.issue) throw ToolError.internal('Failed to move issue — no issue returned');

    return { issue: mapIssue(data.issueUpdate.issue as Parameters<typeof mapIssue>[0]) };
  },
});
