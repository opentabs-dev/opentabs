import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { initiativeSchema, mapInitiative } from './schemas.js';

export const updateInitiative = defineTool({
  name: 'update_initiative',
  displayName: 'Update Initiative',
  description: 'Update an existing Linear initiative. Only specified fields are changed.',
  summary: 'Update an existing initiative',
  icon: 'target',
  group: 'Initiatives',
  input: z.object({
    initiative_id: z.string().describe('Initiative UUID to update'),
    name: z.string().optional().describe('New initiative name'),
    description: z.string().optional().describe('New initiative description in markdown'),
    status: z.enum(['Planned', 'Active', 'Completed']).optional().describe('New initiative status'),
    color: z.string().optional().describe('New color hex code'),
    owner_id: z.string().optional().describe('New owner user UUID'),
  }),
  output: z.object({
    initiative: initiativeSchema.describe('The updated initiative'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {};
    if (params.name !== undefined) input.name = params.name;
    if (params.description !== undefined) input.description = params.description;
    if (params.status !== undefined) input.status = params.status;
    if (params.color !== undefined) input.color = params.color;
    if (params.owner_id !== undefined) input.ownerId = params.owner_id;

    const data = await graphql<{
      initiativeUpdate: {
        success: boolean;
        initiative: Record<string, unknown>;
      };
    }>(
      `mutation UpdateInitiative($id: String!, $input: InitiativeUpdateInput!) {
        initiativeUpdate(id: $id, input: $input) {
          success
          initiative {
            id name description status color icon url createdAt updatedAt
            owner { name displayName }
          }
        }
      }`,
      { id: params.initiative_id, input },
    );

    if (!data.initiativeUpdate?.initiative)
      throw ToolError.internal('Initiative update failed — no initiative returned');

    return {
      initiative: mapInitiative(data.initiativeUpdate.initiative as Parameters<typeof mapInitiative>[0]),
    };
  },
});
