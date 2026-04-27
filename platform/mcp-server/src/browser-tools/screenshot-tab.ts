/**
 * browser_screenshot_tab — capture a screenshot of a browser tab as a base64-encoded PNG.
 */

import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const screenshotTab = defineBrowserTool({
  name: 'browser_screenshot_tab',
  description:
    'Capture a screenshot of the visible area of a browser tab as a base64-encoded PNG image. ' +
    'The tab is automatically focused before capture. By default returns the image as a base64 ' +
    'string without the data URI prefix. When `filePath` is provided, the PNG bytes are written ' +
    'to that absolute path and a `{savedTo, bytes}` summary is returned instead — useful when ' +
    'the caller needs the screenshot as an on-disk artefact rather than an inline payload.',
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
          'path and `{savedTo: <path>, bytes: <number>}` is returned in place of the inline base64 ' +
          'image. The parent directory must already exist; an existing file at the path is overwritten.',
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
    if (typeof data !== 'string') {
      const payloadType = result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result;
      const keys = result !== null && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result) : [];
      throw new Error(
        `browser_screenshot_tab: extension returned unexpected payload (expected {image: string}, got type=${payloadType}${keys.length > 0 ? `, keys=[${keys.join(',')}]` : ''})`,
      );
    }
    const bytes = Buffer.from(data, 'base64');
    await writeFile(args.filePath, bytes);
    return { savedTo: args.filePath, bytes: bytes.byteLength };
  },
});

export { screenshotTab };
