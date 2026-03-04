import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi } from '../figma-api.js';
import type { RawFile } from './schemas.js';
import { fileSchema, mapFile } from './schemas.js';

export const updateFile = defineTool({
  name: 'update_file',
  displayName: 'Update File',
  description: 'Update a Figma file — currently supports renaming and updating the description',
  summary: 'Update a file name or description',
  icon: 'pencil',
  group: 'Files',
  input: z.object({
    file_key: z.string().min(1).describe('File key to update'),
    name: z.string().optional().describe('New file name'),
    description: z.string().optional().describe('New file description'),
  }),
  output: z.object({
    file: fileSchema.describe('The updated file metadata'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.description !== undefined) body.description = params.description;

    const data = await figmaApi<{ meta?: RawFile }>(`/files/${params.file_key}`, {
      method: 'PUT',
      body,
    });
    return { file: mapFile(data.meta ?? {}) };
  },
});
