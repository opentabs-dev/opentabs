import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi } from '../figma-api.js';
import type { RawFile } from './schemas.js';
import { fileSchema, mapFile } from './schemas.js';

export const getFile = defineTool({
  name: 'get_file',
  displayName: 'Get File',
  description: 'Get detailed metadata for a specific Figma file by its file key',
  summary: 'Get metadata for a file',
  icon: 'file',
  group: 'Files',
  input: z.object({
    file_key: z.string().min(1).describe('Unique file key (e.g., "XjkWXw6sWdGlio3PM5lP36")'),
  }),
  output: z.object({
    file: fileSchema.describe('File metadata'),
  }),
  handle: async params => {
    const data = await figmaApi<{ meta?: RawFile }>(`/files/${params.file_key}/meta`);
    return { file: mapFile(data.meta ?? {}) };
  },
});
