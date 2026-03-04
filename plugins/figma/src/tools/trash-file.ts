import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi } from '../figma-api.js';
import type { RawFile } from './schemas.js';
import { fileSchema, mapFile } from './schemas.js';

export const trashFile = defineTool({
  name: 'trash_file',
  displayName: 'Trash File',
  description: 'Move a Figma file to the trash. Trashed files can be restored.',
  icon: 'trash-2',
  group: 'Files',
  input: z.object({
    file_key: z.string().min(1).describe('File key to trash'),
  }),
  output: z.object({
    file: fileSchema.describe('The trashed file metadata'),
  }),
  handle: async params => {
    const data = await figmaApi<{ meta?: RawFile }>(`/files/${params.file_key}`, {
      method: 'PUT',
      body: { trashed: true },
    });
    return { file: mapFile(data.meta ?? {}) };
  },
});
