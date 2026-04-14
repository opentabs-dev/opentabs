/**
 * browser_get_download_status — gets the current status of a specific download.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const getDownloadStatus = defineBrowserTool({
  name: 'browser_get_download_status',
  description:
    'Get the current status of a download by its ID. Returns the download state (in_progress/interrupted/complete), ' +
    'filename, url, bytesReceived, totalBytes, startTime, endTime, and filepath. ' +
    'Use browser_download_file to initiate a download and get the download ID.',
  summary: 'Get download status by ID',
  icon: 'download',
  group: 'Downloads',
  input: z.object({
    downloadId: z.number().int().describe('The download ID to check'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.getDownloadStatus', args),
});

export { getDownloadStatus };
