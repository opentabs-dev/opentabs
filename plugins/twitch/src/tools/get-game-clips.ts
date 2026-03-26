import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { gql } from '../twitch-api.js';
import { clipSchema, mapClip } from './schemas.js';
import type { RawClip } from './schemas.js';

export const getGameClips = defineTool({
  name: 'get_game_clips',
  displayName: 'Get Game Clips',
  description:
    'Get top clips for a specific game/category on Twitch. Provide the game name and optionally filter by time period.',
  summary: 'Get top clips for a game or category',
  icon: 'clapperboard',
  group: 'Clips',
  input: z.object({
    name: z.string().describe('Game name (e.g., "Fortnite", "Just Chatting")'),
    period: z
      .enum(['LAST_DAY', 'LAST_WEEK', 'LAST_MONTH', 'ALL_TIME'])
      .optional()
      .describe('Time period filter (default LAST_WEEK)'),
    first: z.number().int().min(1).max(25).optional().describe('Number of clips to return (default 10, max 25)'),
  }),
  output: z.object({ clips: z.array(clipSchema) }),
  handle: async params => {
    const first = params.first ?? 10;
    const period = params.period ?? 'LAST_WEEK';
    const data = await gql<{
      game: { clips: { edges: Array<{ node: RawClip }> } } | null;
    }>(`{
      game(name: "${params.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}") {
        clips(first: ${first}, criteria: { period: ${period} }) {
          edges {
            node {
              id slug title viewCount createdAt thumbnailURL durationSeconds
              broadcaster { id login displayName }
              game { id name }
            }
          }
        }
      }
    }`);
    if (!data.game) throw ToolError.notFound(`Game "${params.name}" not found`);
    return {
      clips: (data.game.clips?.edges ?? []).map(e => mapClip(e.node)),
    };
  },
});
