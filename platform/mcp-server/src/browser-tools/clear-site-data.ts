/**
 * browser_clear_site_data — clears browsing data for a specific origin via chrome.browsingData API.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const clearSiteData = defineBrowserTool({
  name: 'browser_clear_site_data',
  description:
    'Clear browsing data for a specific origin. Selectively clear cookies, localStorage, cache, ' +
    'IndexedDB, and/or service workers. By default clears cookies and localStorage. ' +
    'Useful for resetting site state or debugging authentication issues.',
  summary: 'Clear site data',
  icon: 'eraser',
  group: 'Data',
  input: z.object({
    origin: z.string().url().describe('Origin to clear data for (e.g., https://example.com)'),
    cookies: z.boolean().optional().describe('Clear cookies (default: true)'),
    localStorage: z.boolean().optional().describe('Clear localStorage (default: true)'),
    cache: z.boolean().optional().describe('Clear cache (default: false)'),
    indexedDB: z.boolean().optional().describe('Clear IndexedDB (default: false)'),
    serviceWorkers: z.boolean().optional().describe('Clear service workers (default: false)'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.clearSiteData', args),
});

export { clearSiteData };
