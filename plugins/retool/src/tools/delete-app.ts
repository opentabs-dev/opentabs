import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const deleteApp = defineTool({
  name: 'delete_app',
  displayName: 'Delete App',
  description:
    'Delete (trash) a Retool app by UUID. The app is moved to the trash folder and can be recovered from there.',
  summary: 'Delete a Retool app',
  icon: 'trash',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID to delete'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  handle: async params => {
    await api<unknown>('/api/pages/deletePage', {
      method: 'POST',
      body: { pageUuid: params.page_uuid },
    });
    return { success: true };
  },
});
