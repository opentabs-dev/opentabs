import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { removeRelatedIssue as removeNativeRelatedIssue } from '../issue-relations.js';
import { issueRelationMutationInputSchema } from './schemas.js';

export const removeRelatedIssue = defineTool({
  name: 'remove_related_issue',
  displayName: 'Remove Related Issue',
  description:
    'Remove GitHub\'s native, undirected "Relates to" relationship between two issues. Blockers, parent/sub-issues, comments, labels, and project fields are left unchanged. The operation is idempotent and verifies the persisted relationship is absent before returning.',
  summary: 'Remove a native Relates to issue relationship',
  icon: 'unlink',
  group: 'Issues',
  input: issueRelationMutationInputSchema,
  output: z.object({
    success: z.boolean().describe('Whether the relationship is absent after the operation'),
  }),
  handle: async params => {
    await removeNativeRelatedIssue(
      {
        owner: params.owner,
        repo: params.repo,
        issueNumber: params.issue_number,
      },
      {
        owner: params.related_owner ?? params.owner,
        repo: params.related_repo ?? params.repo,
        issueNumber: params.related_issue_number,
      },
    );

    return { success: true };
  },
});
