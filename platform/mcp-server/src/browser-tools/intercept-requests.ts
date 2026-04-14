/**
 * browser_intercept_requests — enable CDP Fetch interception for a tab.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const interceptRequests = defineBrowserTool({
  name: 'browser_intercept_requests',
  description:
    'Start intercepting HTTP requests for a browser tab using the Chrome DevTools Protocol Fetch domain. ' +
    'Intercepted requests are paused and can be fulfilled with custom responses (browser_fulfill_request), ' +
    'failed with an error (browser_fail_request), or released by stopping interception (browser_stop_intercepting). ' +
    'Use urlPatterns to filter which requests to intercept (default: all requests). ' +
    'WARNING: Paused requests block the page — always fulfill, fail, or stop intercepting promptly. ' +
    'Requests not handled within 30 seconds are automatically continued.',
  summary: 'Start intercepting HTTP requests',
  icon: 'route',
  group: 'Network',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to intercept requests for'),
    urlPatterns: z.array(z.string()).optional().describe('URL patterns to intercept (default: ["*"] — all requests)'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.interceptRequests', {
      tabId: args.tabId,
      ...(args.urlPatterns !== undefined ? { urlPatterns: args.urlPatterns } : {}),
    }),
});

export { interceptRequests };
