/**
 * browser_screenshot_tab — capture a screenshot of a browser tab as a PNG image content part.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const screenshotTab = defineBrowserTool({
  name: 'browser_screenshot_tab',
  description:
    'Capture a screenshot of the visible area of a browser tab as a PNG. The tab is ' +
    'automatically focused before capture. Returns an MCP image content part ' +
    '(`{type: "image", data: <base64 PNG>, mimeType: "image/png"}`) so MCP clients ' +
    'decode the image directly without parsing JSON-stringified base64.',
  summary: 'Capture a screenshot of a tab',
  icon: 'camera',
  group: 'Page Inspection',
  input: z.object({
    tabId: z
      .number()
      .int()
      .positive()
      .describe('Tab ID to screenshot — the tab will be focused automatically before capture'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.screenshotTab', { tabId: args.tabId }),
  formatResult: result => {
    const data = (result as { image?: unknown } | null)?.image;
    if (typeof data !== 'string') {
      const payloadType = result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result;
      const keys = result !== null && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result) : [];
      throw new Error(
        `browser_screenshot_tab: extension returned unexpected payload (expected {image: string}, got type=${payloadType}${keys.length > 0 ? `, keys=[${keys.join(',')}]` : ''})`,
      );
    }
    return [{ type: 'image', data, mimeType: 'image/png' }];
  },
});

export { screenshotTab };
