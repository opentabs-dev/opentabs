/**
 * browser_get_recently_closed — lists recently closed tabs/windows via chrome.sessions API.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const getRecentlyClosed = defineBrowserTool({
  name: 'browser_get_recently_closed',
  description:
    'Get recently closed tabs and windows (up to 25). Returns sessions with type (tab or window), ' +
    'sessionId, closedAt (ISO string), and details (title, url for tabs; tab count for windows). ' +
    'Use the sessionId with browser_restore_session to restore a closed tab or window.',
  summary: 'Get recently closed tabs',
  icon: 'undo-2',
  group: 'Sessions',
  input: z.object({
    maxResults: z
      .number()
      .int()
      .positive()
      .max(25)
      .optional()
      .describe('Maximum number of sessions to return (default: 25, max: 25)'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.getRecentlyClosed', args),
});

export { getRecentlyClosed };
