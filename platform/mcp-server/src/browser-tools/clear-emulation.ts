/**
 * browser_clear_emulation — clear all emulation overrides for a tab.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const clearEmulation = defineBrowserTool({
  name: 'browser_clear_emulation',
  description:
    'Clear all emulation overrides for a tab — device metrics, user agent, geolocation, media features, ' +
    'and vision deficiency simulation. Resets the tab to its normal state.',
  summary: 'Clear all emulation overrides',
  icon: 'smartphone',
  group: 'Emulation',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to clear emulation for'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.clearEmulation', { tabId: args.tabId }),
});

export { clearEmulation };
