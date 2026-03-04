import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawPage, mapPage, pageSchema } from './schemas.js';

export const getPage = defineTool({
  name: 'get_page',
  displayName: 'Get Page',
  description:
    'Get a Confluence page by its ID, including title, metadata, and optionally the page body content in storage format (HTML)',
  summary: 'Get a page by ID',
  icon: 'file-text',
  group: 'Pages',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to retrieve'),
    include_body: z
      .boolean()
      .optional()
      .describe('Whether to include the page body content (default false — set to true to read page content)'),
  }),
  output: z.object({
    page: pageSchema
      .extend({
        body: z.string().nullable().describe('Page body in storage format (HTML), or null if not requested'),
      })
      .describe('The requested page'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params.include_body) query['body-format'] = 'storage';

    const data = await apiV2<
      RawPage & {
        body?: { storage?: { value?: string } };
      }
    >(`/pages/${params.page_id}`, { query });

    const page = mapPage(data);
    return {
      page: {
        ...page,
        body: data.body?.storage?.value ?? null,
      },
    };
  },
});
