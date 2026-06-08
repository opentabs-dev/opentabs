import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { appSchema, folderSchema, mapApp, mapFolder, type RawApp, type RawFolder } from './schemas.js';

export const listApps = defineTool({
  name: 'list_apps',
  displayName: 'List Apps',
  description:
    'List all apps (pages) and folders in the Retool organization. Returns both apps and their folder structure. Apps include web apps, mobile apps, modules, and forms.',
  summary: 'List all Retool apps and folders',
  icon: 'layout-grid',
  group: 'Apps',
  input: z.object({}),
  output: z.object({
    apps: z.array(appSchema).describe('List of apps'),
    folders: z.array(folderSchema).describe('List of folders'),
  }),
  handle: async () => {
    const data = await api<{ pages: RawApp[]; folders: RawFolder[] }>('/api/pages');
    return {
      apps: (data.pages ?? []).map(mapApp),
      folders: (data.folders ?? []).map(mapFolder),
    };
  },
});
