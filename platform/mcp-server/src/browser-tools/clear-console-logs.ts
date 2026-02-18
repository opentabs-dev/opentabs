/**
 * browser_clear_console_logs — clear the console log buffer for a browser tab.
 */

import { defineBrowserTool } from './definition.js';
import { dispatchToExtension } from '../extension-protocol.js';
import { z } from 'zod';

const clearConsoleLogs = defineBrowserTool({
  name: 'browser_clear_console_logs',
  description: 'Clear the console log buffer for a browser tab without disabling capture.',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to clear console logs for'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.clearConsoleLogs', { tabId: args.tabId }),
});

export { clearConsoleLogs };
