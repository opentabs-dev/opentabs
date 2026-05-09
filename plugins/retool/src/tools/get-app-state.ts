import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const getAppState = defineTool({
  name: 'get_app_state',
  displayName: 'Get App State',
  description:
    'Get the current app state (Transit-encoded JSON) for a Retool app. Returns the serialized component tree including all widgets, queries, and layout. Use this to read an app before modifying it with save_page. The app_state field is the Transit JSON string that can be parsed, modified, and saved back.',
  summary: 'Get serialized app state for modification',
  icon: 'code',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID (from list_apps or create_app results)'),
  }),
  output: z.object({
    save_id: z.number().describe('Current save ID (needed for conflict detection)'),
    app_state: z.string().describe('Transit-encoded app state JSON string'),
    page_id: z.number().describe('Numeric page ID'),
  }),
  handle: async params => {
    const data = await api<{
      page: { id: number; pageId: number; data: { appState: string } };
    }>(`/api/pages/uuids/${params.page_uuid}`);

    return {
      save_id: data.page.id,
      app_state: data.page.data.appState,
      page_id: data.page.pageId,
    };
  },
});
