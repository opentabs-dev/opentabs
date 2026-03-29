import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { initiativeSchema, mapInitiative } from './schemas.js';

export const createInitiative = defineTool({
  name: 'create_initiative',
  displayName: 'Create Initiative',
  description: 'Create a new initiative in Linear.',
  summary: 'Create a new initiative',
  icon: 'target',
  group: 'Initiatives',
  input: z.object({
    name: z.string().describe('Initiative name'),
    description: z.string().optional().describe('Initiative description in markdown'),
    status: z.enum(['Planned', 'Active', 'Completed']).optional().describe('Initiative status'),
    color: z.string().optional().describe('Color hex code (e.g. #FF0000)'),
    owner_id: z.string().optional().describe('Owner user UUID'),
  }),
  output: z.object({
    initiative: initiativeSchema.describe('The newly created initiative'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {
      name: params.name,
    };
    if (params.description !== undefined) input.description = params.description;
    if (params.status) input.status = params.status;
    if (params.color) input.color = params.color;
    if (params.owner_id) input.ownerId = params.owner_id;

    const data = await graphql<{
      initiativeCreate: {
        success: boolean;
        initiative: Record<string, unknown>;
      };
    }>(
      `mutation CreateInitiative($input: InitiativeCreateInput!) {
        initiativeCreate(input: $input) {
          success
          initiative {
            id name description status color icon url createdAt updatedAt
            owner { name displayName }
          }
        }
      }`,
      { input },
    );

    if (!data.initiativeCreate?.initiative)
      throw ToolError.internal('Initiative creation failed — no initiative returned');

    return {
      initiative: mapInitiative(data.initiativeCreate.initiative as Parameters<typeof mapInitiative>[0]),
    };
  },
});
