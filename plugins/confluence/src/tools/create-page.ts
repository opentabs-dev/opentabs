import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawPage, mapPage, pageSchema } from './schemas.js';

export const createPage = defineTool({
  name: 'create_page',
  displayName: 'Create Page',
  description: 'Create a new Confluence page in a space. The body content uses Confluence storage format (HTML).',
  summary: 'Create a new page',
  icon: 'file-plus',
  group: 'Pages',
  input: z.object({
    space_id: z.string().min(1).describe('Space ID to create the page in'),
    title: z.string().min(1).describe('Page title'),
    body: z.string().describe('Page body in storage format (HTML) — e.g., "<p>Hello world</p>"'),
    parent_id: z.string().optional().describe('Parent page ID — omit to create at the space root'),
    status: z.string().optional().describe('Page status: "current" (published, default) or "draft"'),
  }),
  output: z.object({
    page: pageSchema.describe('The created page'),
  }),
  handle: async params => {
    const requestBody: Record<string, unknown> = {
      spaceId: params.space_id,
      title: params.title,
      body: {
        representation: 'storage',
        value: params.body,
      },
      status: params.status ?? 'current',
    };
    if (params.parent_id) requestBody.parentId = params.parent_id;

    const data = await apiV2<RawPage>('/pages', {
      method: 'POST',
      body: requestBody,
    });

    return { page: mapPage(data) };
  },
});
