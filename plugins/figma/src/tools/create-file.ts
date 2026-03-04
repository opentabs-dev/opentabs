import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi, getAuthContext } from '../figma-api.js';
import type { RawFile } from './schemas.js';
import { fileSchema, mapFile } from './schemas.js';

export const createFile = defineTool({
  name: 'create_file',
  displayName: 'Create File',
  description: 'Create a new Figma design file in a specified folder',
  icon: 'file-plus',
  group: 'Files',
  input: z.object({
    name: z.string().min(1).describe('Name for the new file'),
    folder_id: z.string().min(1).describe('Folder/project ID to create the file in'),
    editor_type: z.string().optional().describe('Editor type: "design" (default), "figjam", or "slides"'),
  }),
  output: z.object({
    file: fileSchema.describe('The newly created file'),
  }),
  handle: async params => {
    const { teamId } = getAuthContext();
    const data = await figmaApi<{ meta?: RawFile }>('/files', {
      method: 'POST',
      body: {
        name: params.name,
        editor_type: params.editor_type ?? 'design',
        folder_id: params.folder_id,
        team_id: teamId,
      },
    });
    return { file: mapFile(data.meta ?? {}) };
  },
});
