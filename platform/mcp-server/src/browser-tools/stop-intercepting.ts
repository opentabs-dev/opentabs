/**
 * browser_stop_intercepting — disable request interception for a tab.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const stopIntercepting = defineBrowserTool({
  name: 'browser_stop_intercepting',
  description:
    'Stop intercepting HTTP requests for a tab. Disables the CDP Fetch domain and releases all paused requests. ' +
    'Any requests still paused when this is called are automatically continued.',
  summary: 'Stop intercepting HTTP requests',
  icon: 'route',
  group: 'Network',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to stop intercepting for'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.stopIntercepting', { tabId: args.tabId }),
});

export { stopIntercepting };
