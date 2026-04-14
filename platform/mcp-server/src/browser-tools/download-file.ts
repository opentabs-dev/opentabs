/**
 * browser_download_file — initiates a file download via chrome.downloads API.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const downloadFile = defineBrowserTool({
  name: 'browser_download_file',
  description:
    'Download a file from a URL. Optionally specify a filename and whether to prompt the user with a Save As dialog. ' +
    'Returns the download ID which can be used with browser_get_download_status to check progress.',
  summary: 'Download a file from a URL',
  icon: 'download',
  group: 'Downloads',
  input: z.object({
    url: z.string().describe('URL of the file to download'),
    filename: z.string().optional().describe('Suggested filename for the download'),
    saveAs: z.boolean().optional().describe('Show Save As dialog to the user (default: false)'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.downloadFile', args),
});

export { downloadFile };
