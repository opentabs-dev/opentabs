/**
 * browser_list_downloads — lists recent downloads with optional filtering.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const listDownloads = defineBrowserTool({
  name: 'browser_list_downloads',
  description:
    'List recent downloads with optional filtering by filename, URL, or state. ' +
    'Returns download entries with id, filename, url, state (in_progress/interrupted/complete), ' +
    'bytesReceived, totalBytes, and startTime. Use browser_get_download_status for detailed progress on a specific download.',
  summary: 'List recent downloads',
  icon: 'download',
  group: 'Downloads',
  input: z.object({
    query: z.string().optional().describe('Filter by filename or URL substring'),
    state: z.enum(['in_progress', 'interrupted', 'complete']).optional().describe('Filter by download state'),
    limit: z.number().int().positive().optional().describe('Maximum number of downloads to return (default: 20)'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.listDownloads', args),
});

export { listDownloads };
