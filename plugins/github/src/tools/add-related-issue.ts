import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { addRelatedIssue as addNativeRelatedIssue } from '../issue-relations.js';
import { issueRelationMutationInputSchema } from './schemas.js';

export const addRelatedIssue = defineTool({
  name: 'add_related_issue',
  displayName: 'Add Related Issue',
  description:
    'Add GitHub\'s native, undirected "Relates to" relationship between two issues. This does not create a blocker, parent/sub-issue, comment, label, or project field. The operation is idempotent and verifies the persisted relationship before returning.',
  summary: 'Add a native Relates to issue relationship',
  icon: 'link-2',
  group: 'Issues',
  input: issueRelationMutationInputSchema,
  output: z.object({
    success: z.boolean().describe('Whether the relationship exists after the operation'),
  }),
  handle: async params => {
    await addNativeRelatedIssue(
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
