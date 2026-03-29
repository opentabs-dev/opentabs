import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const addIssueSubscriber = defineTool({
  name: 'add_issue_subscriber',
  displayName: 'Add Issue Subscriber',
  description: 'Subscribe a user to receive notifications for a Linear issue.',
  summary: 'Subscribe a user to an issue',
  icon: 'bell-plus',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to subscribe to'),
    subscriber_id: z.string().describe('User UUID to subscribe (use list_users to find user IDs)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the subscription was successfully created'),
  }),
  handle: async params => {
    const data = await graphql<{
      issueSubscribe: { success: boolean };
    }>(
      `mutation AddIssueSubscriber($id: String!, $userId: String!) {
        issueSubscribe(id: $id, userId: $userId) {
          success
        }
      }`,
      { id: params.issue_id, userId: params.subscriber_id },
    );

    if (!data.issueSubscribe) throw ToolError.internal('Failed to subscribe — no response');

    return { success: data.issueSubscribe.success };
  },
});
