import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawPageSave, mapPageSave, pageSaveSchema } from './schemas.js';

export const listPageSaves = defineTool({
  name: 'list_page_saves',
  displayName: 'List Page Saves',
  description:
    'List the edit history (saved versions) for a Retool app. Shows who made each save and when. Useful for auditing changes and understanding who last modified an app.',
  summary: 'List edit history for an app',
  icon: 'history',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID'),
  }),
  output: z.object({
    saves: z.array(pageSaveSchema).describe('List of save records'),
  }),
  handle: async params => {
    const data = await api<{ saves?: RawPageSave[] }>(`/api/pages/uuids/${params.page_uuid}/saves`);
    return { saves: (data.saves ?? []).map(mapPageSave) };
  },
});
