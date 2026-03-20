import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawAppTag, appTagSchema, mapAppTag } from './schemas.js';

export const listAppTags = defineTool({
  name: 'list_app_tags',
  displayName: 'List App Tags',
  description:
    'List published version tags (releases) for a Retool application. Tags are named snapshots deployed to end users.',
  summary: 'List version tags for an app',
  icon: 'tag',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID'),
  }),
  output: z.object({
    tags: z.array(appTagSchema).describe('List of version tags'),
  }),
  handle: async params => {
    const data = await api<{ tags?: RawAppTag[] }>(`/api/pages/uuids/${params.page_uuid}/tags`);
    return { tags: (data.tags ?? []).map(mapAppTag) };
  },
});
