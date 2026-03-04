import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawPage, mapPage, pageSchema } from './schemas.js';

export const updatePage = defineTool({
  name: 'update_page',
  displayName: 'Update Page',
  description:
    'Update an existing Confluence page. Requires the current version number (get it from get_page). The body uses Confluence storage format (HTML).',
  summary: 'Update an existing page',
  icon: 'file-pen',
  group: 'Pages',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to update'),
    title: z.string().min(1).describe('New page title'),
    body: z.string().describe('New page body in storage format (HTML)'),
    version_number: z
      .number()
      .int()
      .min(1)
      .describe('Current version number of the page — the update increments this by 1'),
    version_message: z.string().optional().describe('Optional message describing the changes'),
    status: z.string().optional().describe('Page status: "current" (default) or "draft"'),
  }),
  output: z.object({
    page: pageSchema.describe('The updated page'),
  }),
  handle: async params => {
    const data = await apiV2<RawPage>(`/pages/${params.page_id}`, {
      method: 'PUT',
      body: {
        id: params.page_id,
        title: params.title,
        status: params.status ?? 'current',
        body: {
          representation: 'storage',
          value: params.body,
        },
        version: {
          number: params.version_number + 1,
          message: params.version_message ?? '',
        },
      },
    });

    return { page: mapPage(data) };
  },
});
