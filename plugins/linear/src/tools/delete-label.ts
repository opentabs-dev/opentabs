import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const deleteLabel = defineTool({
  name: 'delete_label',
  displayName: 'Delete Label',
  description: 'Delete a Linear issue label. Labels will be removed from all issues that use them.',
  summary: 'Delete a label',
  icon: 'tag',
  group: 'Workflow',
  input: z.object({
    label_id: z.string().describe('Label UUID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the label was successfully deleted'),
  }),
  handle: async params => {
    const data = await graphql<{
      issueLabelDelete: { success: boolean };
    }>(
      `mutation DeleteLabel($id: String!) {
        issueLabelDelete(id: $id) {
          success
        }
      }`,
      { id: params.label_id },
    );

    if (!data.issueLabelDelete) throw ToolError.internal('Label deletion failed — no response');

    return { success: data.issueLabelDelete.success };
  },
});
