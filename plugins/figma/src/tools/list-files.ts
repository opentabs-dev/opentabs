import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi, getAuthContext } from '../figma-api.js';
import type { RawFile } from './schemas.js';
import { fileSchema, mapFile } from './schemas.js';

export const listFiles = defineTool({
  name: 'list_files',
  displayName: 'List Files',
  description: 'List files in a Figma folder or project. Use the folder_id from team roles or project info.',
  icon: 'folder',
  group: 'Files',
  input: z.object({
    folder_id: z.string().min(1).describe('Folder/project ID to list files from'),
  }),
  output: z.object({
    files: z.array(fileSchema).describe('Array of files in the folder'),
  }),
  handle: async params => {
    const { fuid } = getAuthContext();
    const data = await figmaApi<{ meta?: { files?: RawFile[] } }>(`/folders/${params.folder_id}/files`, {
      query: { fuid },
    });
    const files = (data.meta?.files ?? []).map(mapFile);
    return { files };
  },
});
