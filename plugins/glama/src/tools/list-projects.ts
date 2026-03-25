import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import { type RawProject, mapProject, projectSchema } from './schemas.js';

interface ProjectsRouteData {
  projects?: RawProject[];
}

export const listProjectsTool = defineTool({
  name: 'list_projects',
  displayName: 'List Projects',
  description: 'List all projects in the workspace.',
  summary: 'List all projects in the workspace',
  icon: 'folder',
  group: 'Projects',
  input: z.object({}),
  output: z.object({
    projects: z.array(projectSchema).describe('Workspace projects'),
  }),
  handle: async () => {
    const data = await navigateAndLoad<ProjectsRouteData>(
      '/projects',
      'routes/_authenticated/_app/projects/_index/_route',
    );

    const projects = (data.projects ?? []).map(mapProject);
    return { projects };
  },
});
