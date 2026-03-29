import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { initiativeSchema, mapInitiative, projectSchema, mapProject } from './schemas.js';

export const getInitiative = defineTool({
  name: 'get_initiative',
  displayName: 'Get Initiative',
  description: 'Get detailed information about a single Linear initiative by its UUID.',
  summary: 'Get details of a single initiative',
  icon: 'target',
  group: 'Initiatives',
  input: z.object({
    initiative_id: z.string().describe('Initiative UUID'),
  }),
  output: z.object({
    initiative: initiativeSchema.describe('The requested initiative'),
    projects: z.array(projectSchema).describe('Projects associated with this initiative'),
  }),
  handle: async params => {
    const data = await graphql<{
      initiative: Record<string, unknown> & {
        projects?: { nodes?: Record<string, unknown>[] };
      };
    }>(
      `query GetInitiative($id: String!) {
        initiative(id: $id) {
          id name description status color icon url createdAt updatedAt
          owner { name displayName }
          projects {
            nodes {
              id name description url createdAt updatedAt
              status { name }
              lead { name displayName }
              targetDate startDate
            }
          }
        }
      }`,
      { id: params.initiative_id },
    );

    if (!data.initiative) throw ToolError.notFound('Initiative not found');

    return {
      initiative: mapInitiative(data.initiative as Parameters<typeof mapInitiative>[0]),
      projects: (data.initiative.projects?.nodes ?? []).map(p => mapProject(p as Parameters<typeof mapProject>[0])),
    };
  },
});
