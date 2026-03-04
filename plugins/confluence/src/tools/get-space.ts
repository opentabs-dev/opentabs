import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawSpace, mapSpace, spaceSchema } from './schemas.js';

export const getSpace = defineTool({
  name: 'get_space',
  displayName: 'Get Space',
  description: 'Get detailed information about a specific Confluence space by its ID',
  summary: 'Get a space by ID',
  icon: 'folder-open',
  group: 'Spaces',
  input: z.object({
    space_id: z.string().min(1).describe('Space ID to retrieve'),
  }),
  output: z.object({
    space: spaceSchema.describe('The requested space'),
  }),
  handle: async params => {
    const data = await apiV2<RawSpace>(`/spaces/${params.space_id}`);
    return { space: mapSpace(data) };
  },
});
