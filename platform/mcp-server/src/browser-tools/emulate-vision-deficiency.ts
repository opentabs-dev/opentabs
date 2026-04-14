/**
 * browser_emulate_vision_deficiency — simulate vision deficiencies via CDP.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const emulateVisionDeficiency = defineBrowserTool({
  name: 'browser_emulate_vision_deficiency',
  description:
    'Simulate a vision deficiency for a tab using the Chrome DevTools Protocol Emulation domain. ' +
    'Useful for testing accessibility. Set type to "none" to remove the simulation. ' +
    'The override persists until cleared with browser_clear_emulation or the debugger is detached.',
  summary: 'Simulate a vision deficiency',
  icon: 'smartphone',
  group: 'Emulation',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to emulate vision deficiency on'),
    type: z
      .enum(['none', 'blurredVision', 'deuteranopia', 'protanopia', 'tritanopia', 'achromatopsia'])
      .describe('Vision deficiency type'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.emulateVisionDeficiency', {
      tabId: args.tabId,
      type: args.type,
    }),
});

export { emulateVisionDeficiency };
