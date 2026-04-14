/**
 * browser_throttle_network — simulate slow network conditions via CDP Network.emulateNetworkConditions.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const throttleNetwork = defineBrowserTool({
  name: 'browser_throttle_network',
  description:
    'Simulate slow network conditions for a tab using the Chrome DevTools Protocol Network domain. ' +
    'Choose a preset (offline, slow-3g, 3g, 4g, wifi) or provide custom latency and throughput values. ' +
    'Throttling persists until cleared with browser_clear_network_throttle or the debugger is detached. ' +
    'Presets match Chrome DevTools defaults.',
  summary: 'Simulate slow network conditions',
  icon: 'gauge',
  group: 'Network',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to throttle'),
    preset: z
      .enum(['offline', 'slow-3g', '3g', '4g', 'wifi'])
      .optional()
      .describe('Network condition preset (overrides custom values if set)'),
    latency: z.number().min(0).optional().describe('Latency in ms (used when no preset)'),
    downloadThroughput: z.number().min(0).optional().describe('Download speed in bytes/sec (used when no preset)'),
    uploadThroughput: z.number().min(0).optional().describe('Upload speed in bytes/sec (used when no preset)'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.throttleNetwork', {
      tabId: args.tabId,
      ...(args.preset !== undefined ? { preset: args.preset } : {}),
      ...(args.latency !== undefined ? { latency: args.latency } : {}),
      ...(args.downloadThroughput !== undefined ? { downloadThroughput: args.downloadThroughput } : {}),
      ...(args.uploadThroughput !== undefined ? { uploadThroughput: args.uploadThroughput } : {}),
    }),
});

export { throttleNetwork };
