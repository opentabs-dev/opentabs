import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const getApp = defineTool({
  name: 'get_app',
  displayName: 'Get App',
  description:
    'Get a Retool application by UUID. Returns the page save record including serialized app state, change history, and metadata. For a human-readable lookup by path, use lookup_app instead.',
  summary: 'Get app details by UUID',
  icon: 'app-window',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID (from list_apps results)'),
  }),
  output: z.object({
    page: z.record(z.string(), z.unknown()).describe('Full page save record with app state'),
  }),
  handle: async params => {
    const data = await api<Record<string, unknown>>(`/api/pages/uuids/${params.page_uuid}`);
    return { page: data ?? {} };
  },
});
