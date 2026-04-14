/**
 * browser_set_media_features — override emulated media features via CDP.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const setMediaFeatures = defineBrowserTool({
  name: 'browser_set_media_features',
  description:
    'Override CSS media features for a tab using the Chrome DevTools Protocol Emulation domain. ' +
    'Supports features like prefers-color-scheme (light/dark), prefers-reduced-motion (reduce/no-preference), ' +
    'prefers-contrast (more/less/no-preference), and color-gamut (srgb/p3/rec2020). ' +
    'The override persists until cleared with browser_clear_emulation or the debugger is detached.',
  summary: 'Override CSS media features',
  icon: 'smartphone',
  group: 'Emulation',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to set media features for'),
    features: z
      .array(
        z.object({
          name: z.string().describe('Media feature name (e.g., prefers-color-scheme)'),
          value: z.string().describe('Media feature value (e.g., dark)'),
        }),
      )
      .min(1)
      .describe('Array of media feature name/value pairs'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.setMediaFeatures', {
      tabId: args.tabId,
      features: args.features,
    }),
});

export { setMediaFeatures };
