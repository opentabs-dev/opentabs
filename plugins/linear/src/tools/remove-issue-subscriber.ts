import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const removeIssueSubscriber = defineTool({
  name: 'remove_issue_subscriber',
  displayName: 'Remove Issue Subscriber',
  description: 'Unsubscribe a user from notifications for a Linear issue.',
  summary: 'Unsubscribe a user from an issue',
  icon: 'bell-minus',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to unsubscribe from'),
    subscriber_id: z.string().describe('User UUID to unsubscribe'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unsubscription was successful'),
  }),
  handle: async params => {
    const data = await graphql<{
      issueUnsubscribe: { success: boolean };
    }>(
      `mutation RemoveIssueSubscriber($id: String!, $userId: String!) {
        issueUnsubscribe(id: $id, userId: $userId) {
          success
        }
      }`,
      { id: params.issue_id, userId: params.subscriber_id },
    );

    if (!data.issueUnsubscribe) throw ToolError.internal('Failed to unsubscribe — no response');

    return { success: data.issueUnsubscribe.success };
  },
});
