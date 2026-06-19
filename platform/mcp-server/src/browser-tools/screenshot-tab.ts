/**
 * browser_screenshot_tab — capture a screenshot of a browser tab as a PNG.
 *
 * By default the PNG is returned as an MCP image content part so clients decode
 * it directly without parsing JSON-stringified base64. When `filePath` is given,
 * the PNG is written to that absolute path and a `{savedTo, bytes}` text summary
 * is returned instead — useful when the caller wants an on-disk artifact rather
 * than an inline payload.
 */

import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const screenshotTab = defineBrowserTool({
  name: 'browser_screenshot_tab',
  description:
    'Capture a screenshot of the visible area of a browser tab as a PNG. The tab is ' +
    'automatically focused before capture. By default returns an MCP image content part ' +
    '(`{type: "image", data: <base64 PNG>, mimeType: "image/png"}`) so MCP clients decode ' +
    'the image directly without parsing JSON-stringified base64. When `filePath` is provided, ' +
    'the PNG bytes are written to that absolute path and a `{savedTo, bytes}` summary is ' +
    'returned instead — useful when the caller needs the screenshot as an on-disk artifact.',
  summary: 'Capture a screenshot of a tab',
  icon: 'camera',
  group: 'Page Inspection',
  input: z.object({
    tabId: z
      .number()
      .int()
      .positive()
      .describe('Tab ID to screenshot — the tab will be focused automatically before capture'),
    filePath: z
      .string()
      .optional()
      .describe(
        'Absolute path to write the captured PNG to. When set, the PNG bytes are written to this ' +
          'path and `{savedTo: <path>, bytes: <number>}` is returned in place of the inline image ' +
          'content part. The parent directory must already exist; an existing file at the path is overwritten.',
      ),
  }),
  handler: async (args, state) => {
    const result = await dispatchToExtension(state, 'browser.screenshotTab', { tabId: args.tabId });
    if (args.filePath === undefined) {
      return result;
    }
    if (!isAbsolute(args.filePath)) {
      throw new Error(
        `browser_screenshot_tab: filePath must be an absolute path (got ${JSON.stringify(args.filePath)})`,
      );
    }
    const data = (result as { image?: unknown } | null)?.image;
    if (typeof data !== 'string' || data.length === 0) {
      const payloadType = result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result;
      const keys = result !== null && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result) : [];
      throw new Error(
        `browser_screenshot_tab: extension returned unexpected payload (expected {image: non-empty string}, got type=${payloadType}${keys.length > 0 ? `, keys=[${keys.join(',')}]` : ''})`,
      );
    }
    const bytes = Buffer.from(data, 'base64');
    await writeFile(args.filePath, bytes);
    return { savedTo: args.filePath, bytes: bytes.byteLength };
  },
  formatResult: result => {
    // The on-disk path: handler returned a {savedTo, bytes} summary — render as text.
    if (result !== null && typeof result === 'object' && 'savedTo' in result) {
      return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    }
    // The default path: handler returned {image} — emit a native MCP image part.
    const data = (result as { image?: unknown } | null)?.image;
    if (typeof data !== 'string' || data.length === 0) {
      const payloadType = result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result;
      const keys = result !== null && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result) : [];
      throw new Error(
        `browser_screenshot_tab: extension returned unexpected payload (expected {image: non-empty string}, got type=${payloadType}${keys.length > 0 ? `, keys=[${keys.join(',')}]` : ''})`,
      );
    }
    return [{ type: 'image', data, mimeType: 'image/png' }];
  },
});

export { screenshotTab };
