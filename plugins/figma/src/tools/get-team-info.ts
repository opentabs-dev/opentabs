import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi, getAuthContext } from '../figma-api.js';
import type { RawTeam } from './schemas.js';
import { mapTeam, teamSchema } from './schemas.js';

export const getTeamInfo = defineTool({
  name: 'get_team_info',
  displayName: 'Get Team Info',
  description: 'Get detailed information about a specific Figma team',
  summary: 'Get details about a team',
  icon: 'info',
  group: 'Teams',
  input: z.object({
    team_id: z.string().min(1).describe('Team ID to get information for'),
  }),
  output: z.object({
    team: teamSchema.describe('Team details'),
  }),
  handle: async params => {
    const { fuid } = getAuthContext();
    const data = await figmaApi<{ meta?: { teams?: RawTeam[] } }>('/user/state', {
      query: { team_id: params.team_id, fuid },
    });
    const teams = data.meta?.teams ?? [];
    const team = teams.find(t => t.id === params.team_id) ?? teams[0];
    if (!team) throw ToolError.notFound('Team not found');
    return { team: mapTeam(team) };
  },
});
