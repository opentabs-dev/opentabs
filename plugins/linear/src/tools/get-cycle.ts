import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { cycleSchema, mapCycle } from './schemas.js';

export const getCycle = defineTool({
  name: 'get_cycle',
  displayName: 'Get Cycle',
  description: 'Get detailed information about a single cycle (sprint) by its UUID.',
  summary: 'Get details of a single cycle',
  icon: 'refresh-cw',
  group: 'Workflow',
  input: z.object({
    cycle_id: z.string().describe('Cycle UUID'),
  }),
  output: z.object({
    cycle: cycleSchema.describe('The requested cycle'),
  }),
  handle: async params => {
    const data = await graphql<{ cycle: Record<string, unknown> }>(
      `query GetCycle($id: String!) {
        cycle(id: $id) {
          id number name startsAt endsAt completedAt
        }
      }`,
      { id: params.cycle_id },
    );

    if (!data.cycle) throw ToolError.notFound('Cycle not found');

    return { cycle: mapCycle(data.cycle as Parameters<typeof mapCycle>[0]) };
  },
});
