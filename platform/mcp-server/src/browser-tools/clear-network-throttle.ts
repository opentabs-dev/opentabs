/**
 * browser_clear_network_throttle — remove network throttling for a tab.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const clearNetworkThrottle = defineBrowserTool({
  name: 'browser_clear_network_throttle',
  description:
    'Remove network throttling for a tab, restoring normal network conditions. ' +
    'Use after browser_throttle_network to stop simulating slow connections.',
  summary: 'Remove network throttling',
  icon: 'gauge',
  group: 'Network',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to clear throttling for'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.clearNetworkThrottle', { tabId: args.tabId }),
});

export { clearNetworkThrottle };
