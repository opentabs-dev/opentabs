import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi } from '../figma-api.js';

const projectSchema = z.object({
  id: z.string().describe('Project ID'),
  name: z.string().describe('Project name'),
});

interface RawProject {
  id?: string | number;
  name?: string;
}

const mapProject = (p: Partial<RawProject>): z.infer<typeof projectSchema> => ({
  id: String(p.id ?? ''),
  name: p.name ?? '',
});

export const listTeamProjects = defineTool({
  name: 'list_team_projects',
  displayName: 'List Team Projects',
  description: 'List all projects in a Figma team. Projects are containers for files within a team.',
  summary: 'List projects in a team',
  icon: 'folder',
  group: 'Teams',
  input: z.object({
    team_id: z.string().min(1).describe('Team ID to list projects for'),
  }),
  output: z.object({
    projects: z.array(projectSchema).describe('Array of projects in the team'),
  }),
  handle: async params => {
    const data = await figmaApi<{ meta?: { projects?: RawProject[] } }>(`/teams/${params.team_id}/projects`);
    const rawProjects = data.meta?.projects ?? [];
    return { projects: rawProjects.map(mapProject) };
  },
});
