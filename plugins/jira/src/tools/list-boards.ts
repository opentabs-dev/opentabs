import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../jira-api.js';

const AGILE_BASE = '/rest/agile/1.0';

const boardSchema = z.object({
  id: z.number().describe('Board ID'),
  name: z.string().describe('Board name'),
  type: z.string().describe('Board type (scrum, kanban, simple)'),
  project_key: z.string().optional().describe('Associated project key'),
  project_name: z.string().optional().describe('Associated project name'),
});

interface JiraBoard {
  id?: number;
  name?: string;
  type?: string;
  location?: { projectKey?: string; projectName?: string };
}

export const listBoards = defineTool({
  name: 'list_boards',
  displayName: 'List Boards',
  description: 'List Jira boards (Scrum and Kanban). Returns board name, type, and associated project.',
  summary: 'List agile boards',
  icon: 'kanban',
  group: 'Boards',
  input: z.object({
    project_key: z.string().optional().describe('Filter boards by project key'),
    type: z.string().optional().describe('Filter by board type: scrum, kanban, simple'),
    max_results: z.number().optional().describe('Maximum number of boards to return (default 50)'),
    start_at: z.number().optional().describe('Index of the first result to return for pagination'),
  }),
  output: z.object({
    boards: z.array(boardSchema).describe('Jira boards'),
    total: z.number().describe('Total number of matching boards'),
  }),
  handle: async params => {
    const data = await api<{
      values?: Record<string, unknown>[];
      total?: number;
    }>('/board', {
      basePath: AGILE_BASE,
      query: {
        projectKeyOrId: params.project_key,
        type: params.type,
        maxResults: params.max_results ?? 50,
        startAt: params.start_at ?? 0,
      },
    });
    return {
      boards: (data.values ?? []).map(item => {
        const b = item as unknown as JiraBoard;
        return {
          id: b.id ?? 0,
          name: b.name ?? '',
          type: b.type ?? '',
          project_key: b.location?.projectKey ?? undefined,
          project_name: b.location?.projectName ?? undefined,
        };
      }),
      total: data.total ?? 0,
    };
  },
});
