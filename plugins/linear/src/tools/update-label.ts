import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { labelSchema, mapLabel } from './schemas.js';

export const updateLabel = defineTool({
  name: 'update_label',
  displayName: 'Update Label',
  description: 'Update an existing Linear issue label. Only specified fields are changed.',
  summary: 'Update a label',
  icon: 'tag',
  group: 'Workflow',
  input: z.object({
    label_id: z.string().describe('Label UUID to update'),
    name: z.string().optional().describe('New label name'),
    color: z.string().optional().describe('New color hex code'),
    description: z.string().optional().describe('New label description'),
  }),
  output: z.object({
    label: labelSchema.describe('The updated label'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {};
    if (params.name !== undefined) input.name = params.name;
    if (params.color !== undefined) input.color = params.color;
    if (params.description !== undefined) input.description = params.description;

    const data = await graphql<{
      issueLabelUpdate: {
        success: boolean;
        issueLabel: Record<string, unknown>;
      };
    }>(
      `mutation UpdateLabel($id: String!, $input: IssueLabelUpdateInput!) {
        issueLabelUpdate(id: $id, input: $input) {
          success
          issueLabel {
            id name color description isGroup
            parent { name }
          }
        }
      }`,
      { id: params.label_id, input },
    );

    if (!data.issueLabelUpdate?.issueLabel) throw ToolError.internal('Label update failed — no label returned');

    return { label: mapLabel(data.issueLabelUpdate.issueLabel as Parameters<typeof mapLabel>[0]) };
  },
});
