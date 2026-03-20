import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

const pageNameSchema = z.object({
  uuid: z.string().describe('Page UUID'),
  name: z.string().describe('Page name'),
});

interface RawPageName {
  uuid?: string;
  name?: string;
  pageName?: string;
}

export const listPageNames = defineTool({
  name: 'list_page_names',
  displayName: 'List Page Names',
  description:
    'Get a lightweight list of all app names and UUIDs. Faster and smaller than list_apps — use this when you only need names and UUIDs, not full metadata.',
  summary: 'List all app names and UUIDs (lightweight)',
  icon: 'list',
  group: 'Apps',
  input: z.object({}),
  output: z.object({
    pages: z.array(pageNameSchema).describe('List of page names and UUIDs'),
  }),
  handle: async () => {
    const data = await api<{ pageNames?: RawPageName[] }>('/api/editor/pageNames');
    return {
      pages: (data.pageNames ?? []).map((p: RawPageName) => ({
        uuid: p.uuid ?? '',
        name: p.name ?? p.pageName ?? '',
      })),
    };
  },
});
