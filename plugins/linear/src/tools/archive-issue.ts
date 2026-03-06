import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const archiveIssue = defineTool({
  name: 'archive_issue',
  displayName: 'Archive Issue',
  description: 'Archive a Linear issue. Archived issues are hidden from default views but can be restored.',
  summary: 'Archive an issue',
  icon: 'archive',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to archive'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the issue was successfully archived'),
  }),
  handle: async params => {
    const data = await graphql<{
      issueArchive: { success: boolean };
    }>(
      `mutation ArchiveIssue($id: String!) {
        issueArchive(id: $id) {
          success
        }
      }`,
      { id: params.issue_id },
    );

    if (!data.issueArchive) throw ToolError.internal('Issue archive failed — no response');

    return { success: data.issueArchive.success };
  },
});
