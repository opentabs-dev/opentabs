/**
 * browser_set_geolocation — override geolocation via CDP Emulation domain.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const setGeolocation = defineBrowserTool({
  name: 'browser_set_geolocation',
  description:
    'Override the geolocation reported by the browser for a tab using the Chrome DevTools Protocol Emulation domain. ' +
    'The override persists until cleared with browser_clear_emulation or the debugger is detached.',
  summary: 'Override geolocation coordinates',
  icon: 'smartphone',
  group: 'Emulation',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to set geolocation for'),
    latitude: z.number().min(-90).max(90).describe('Latitude in degrees'),
    longitude: z.number().min(-180).max(180).describe('Longitude in degrees'),
    accuracy: z.number().min(0).optional().describe('Accuracy in meters (default: 1)'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.setGeolocation', {
      tabId: args.tabId,
      latitude: args.latitude,
      longitude: args.longitude,
      ...(args.accuracy !== undefined ? { accuracy: args.accuracy } : {}),
    }),
});

export { setGeolocation };
