import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawGrid, gridSchema, mapGrid } from './schemas.js';

export const listGrids = defineTool({
  name: 'list_grids',
  displayName: 'List Grids',
  description:
    'List all Retool Database tables (grids). Retool Database is a built-in PostgreSQL database for storing app data.',
  summary: 'List Retool Database tables',
  icon: 'table',
  group: 'Database',
  input: z.object({}),
  output: z.object({
    grids: z.array(gridSchema).describe('List of Retool Database tables'),
  }),
  handle: async () => {
    const data = await api<RawGrid[]>('/api/grid');
    return { grids: (Array.isArray(data) ? data : []).map(mapGrid) };
  },
});
