import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../jira-api.js';

const AGILE_BASE = '/rest/agile/1.0';

const sprintSchema = z.object({
  id: z.number().describe('Sprint ID'),
  name: z.string().describe('Sprint name'),
  state: z.string().describe('Sprint state (active, future, closed)'),
  start_date: z.string().optional().describe('Sprint start date'),
  end_date: z.string().optional().describe('Sprint end date'),
  complete_date: z.string().optional().describe('Sprint completion date'),
  goal: z.string().optional().describe('Sprint goal'),
});

interface JiraSprint {
  id?: number;
  name?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}

export const listSprints = defineTool({
  name: 'list_sprints',
  displayName: 'List Sprints',
  description: 'List sprints for a Jira board. Returns sprint name, state, and dates.',
  summary: 'List sprints for a board',
  icon: 'timer',
  group: 'Boards',
  input: z.object({
    board_id: z.number().describe('Board ID to list sprints for (use list_boards to find IDs)'),
    state: z.string().optional().describe('Filter by sprint state: active, future, closed'),
    max_results: z.number().optional().describe('Maximum number of sprints to return (default 50)'),
    start_at: z.number().optional().describe('Index of the first result to return for pagination'),
  }),
  output: z.object({
    sprints: z.array(sprintSchema).describe('Sprints for the board'),
  }),
  handle: async params => {
    const data = await api<{ values?: Record<string, unknown>[] }>(
      `/board/${encodeURIComponent(params.board_id)}/sprint`,
      {
        basePath: AGILE_BASE,
        query: {
          state: params.state,
          maxResults: params.max_results ?? 50,
          startAt: params.start_at ?? 0,
        },
      },
    );
    return {
      sprints: (data.values ?? []).map(item => {
        const s = item as unknown as JiraSprint;
        return {
          id: s.id ?? 0,
          name: s.name ?? '',
          state: s.state ?? '',
          start_date: s.startDate ?? undefined,
          end_date: s.endDate ?? undefined,
          complete_date: s.completeDate ?? undefined,
          goal: s.goal ?? undefined,
        };
      }),
    };
  },
});
