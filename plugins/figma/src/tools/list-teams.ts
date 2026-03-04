import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi, getAuthContext } from '../figma-api.js';
import type { RawTeam } from './schemas.js';
import { mapTeam, teamSchema } from './schemas.js';

export const listTeams = defineTool({
  name: 'list_teams',
  displayName: 'List Teams',
  description: 'List all Figma teams the current user belongs to',
  summary: 'List teams the user belongs to',
  icon: 'users',
  group: 'Teams',
  input: z.object({}),
  output: z.object({
    teams: z.array(teamSchema).describe('Array of teams'),
  }),
  handle: async () => {
    const { fuid } = getAuthContext();
    const data = await figmaApi<{ meta?: { teams?: RawTeam[] } }>('/session/state', {
      query: { fuid },
    });
    const teams = (data.meta?.teams ?? []).map(mapTeam);
    return { teams };
  },
});
