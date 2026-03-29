import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapTeam, teamSchema } from './schemas.js';

export const getTeam = defineTool({
  name: 'get_team',
  displayName: 'Get Team',
  description: 'Get detailed information about a single Linear team by its UUID.',
  summary: 'Get details of a single team',
  icon: 'users',
  group: 'Teams & Users',
  input: z.object({
    team_id: z.string().describe('Team UUID'),
  }),
  output: z.object({
    team: teamSchema.describe('The requested team'),
  }),
  handle: async params => {
    const data = await graphql<{ team: Record<string, unknown> }>(
      `query GetTeam($id: String!) {
        team(id: $id) {
          id key name description
        }
      }`,
      { id: params.team_id },
    );

    if (!data.team) throw ToolError.notFound('Team not found');

    return { team: mapTeam(data.team as Parameters<typeof mapTeam>[0]) };
  },
});
