import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../clickup-api.js';
import { spaceSchema, mapSpace } from './schemas.js';

export const getSpace = defineTool({
  name: 'get_space',
  displayName: 'Get Space',
  description:
    'Get detailed information about a specific ClickUp space by its ID. Returns space name, color, privacy, features, and statuses.',
  summary: 'Get space details by ID',
  icon: 'layout-grid',
  group: 'Spaces',
  input: z.object({
    space_id: z.string().min(1).describe('Space ID'),
  }),
  output: z.object({ space: spaceSchema.describe('Space details') }),
  handle: async params => {
    const data = await api<Record<string, unknown>>(`/hierarchy/v1/project/${params.space_id}`);
    return { space: mapSpace(data) };
  },
});
