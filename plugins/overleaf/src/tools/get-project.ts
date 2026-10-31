import { defineTool } from '@opentabs-dev/plugin-sdk';
import { getProject } from '../overleaf-api.js';
import { projectInput, projectSchema } from './schemas.js';

export const getProjectTool = defineTool({
  name: 'get_project',
  displayName: 'Get Project',
  description:
    'Read project metadata, permissions, existing main document/compiler settings, and a complete ID-bearing file tree. ' +
    'Requires an authenticated Overleaf editor tab, but project_id may identify another accessible project. ' +
    'Uses a temporary project connection without joining documents, submitting edits, flushing editor buffers, or compiling.',
  summary: 'Read project settings and the ID-bearing file tree',
  icon: 'folder-tree',
  group: 'Projects',
  input: projectInput,
  output: projectSchema,
  handle: params => getProject(params.project_id),
});
