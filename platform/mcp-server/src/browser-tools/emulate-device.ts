/**
 * browser_emulate_device — apply device emulation (viewport, touch, user agent) via CDP.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const emulateDevice = defineBrowserTool({
  name: 'browser_emulate_device',
  description:
    'Emulate a device by overriding viewport dimensions, device scale factor, mobile flag, and user agent string ' +
    'using the Chrome DevTools Protocol Emulation domain. ' +
    'The emulation persists until cleared with browser_clear_emulation or the debugger is detached. ' +
    'Use browser_execute_script to verify changes (e.g., window.innerWidth).',
  summary: 'Emulate a device (viewport, touch, user agent)',
  icon: 'smartphone',
  group: 'Emulation',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to emulate on'),
    width: z.number().int().positive().describe('Viewport width in pixels'),
    height: z.number().int().positive().describe('Viewport height in pixels'),
    deviceScaleFactor: z.number().min(0).optional().describe('Device scale factor (default: 1)'),
    mobile: z.boolean().optional().describe('Whether to emulate a mobile device (default: false)'),
    userAgent: z.string().optional().describe('User agent string override'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.emulateDevice', {
      tabId: args.tabId,
      width: args.width,
      height: args.height,
      ...(args.deviceScaleFactor !== undefined ? { deviceScaleFactor: args.deviceScaleFactor } : {}),
      ...(args.mobile !== undefined ? { mobile: args.mobile } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    }),
});

export { emulateDevice };
