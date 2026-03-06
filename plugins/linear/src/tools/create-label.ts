import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { labelSchema, mapLabel } from './schemas.js';

export const createLabel = defineTool({
  name: 'create_label',
  displayName: 'Create Label',
  description: 'Create a new issue label in Linear.',
  summary: 'Create a new label',
  icon: 'tag',
  group: 'Labels',
  input: z.object({
    name: z.string().describe('Label name'),
    color: z.string().optional().describe('Label color as hex code (e.g. "#ff0000")'),
    description: z.string().optional().describe('Label description'),
    team_id: z.string().optional().describe('Team UUID to scope the label to a specific team'),
  }),
  output: z.object({
    label: labelSchema.describe('The newly created label'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {
      name: params.name,
    };
    if (params.color) input.color = params.color;
    if (params.description !== undefined) input.description = params.description;
    if (params.team_id) input.teamId = params.team_id;

    const data = await graphql<{
      issueLabelCreate: {
        success: boolean;
        issueLabel: Record<string, unknown>;
      };
    }>(
      `mutation CreateLabel($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) {
          success
          issueLabel {
            id name color description isGroup
            parent { name }
          }
        }
      }`,
      { input },
    );

    if (!data.issueLabelCreate?.success) throw ToolError.internal('Label creation failed');
    if (!data.issueLabelCreate.issueLabel) throw ToolError.internal('Label creation failed — no label returned');

    return { label: mapLabel(data.issueLabelCreate.issueLabel as Parameters<typeof mapLabel>[0]) };
  },
});
