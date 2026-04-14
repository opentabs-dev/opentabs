/**
 * browser_restore_session — restores a recently closed tab/window via chrome.sessions API.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const restoreSession = defineBrowserTool({
  name: 'browser_restore_session',
  description:
    'Restore a recently closed tab or window by its session ID. Use browser_get_recently_closed ' +
    'to find session IDs. Returns the restored session details.',
  summary: 'Restore closed tab/window',
  icon: 'undo-2',
  group: 'Sessions',
  input: z.object({
    sessionId: z.string().describe('Session ID from browser_get_recently_closed'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.restoreSession', args),
});

export { restoreSession };
