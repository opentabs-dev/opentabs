/**
 * browser_get_cookies — get cookies for a URL.
 */

import { defineBrowserTool } from './definition.js';
import { safeUrl } from './url-validation.js';
import { dispatchToExtension } from '../extension-protocol.js';
import { z } from 'zod';

const getCookies = defineBrowserTool({
  name: 'browser_get_cookies',
  description:
    'Get cookies for a URL. Returns all cookies that would be sent with a request to that URL, ' +
    'including HttpOnly cookies not accessible to JavaScript. Optionally filter by cookie name.',
  input: z.object({
    url: safeUrl.describe('URL to get cookies for — returns all cookies that would be sent with a request to this URL'),
    name: z.string().optional().describe('Filter by cookie name — omit to get all cookies for the URL'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.getCookies', {
      url: args.url,
      ...(args.name !== undefined ? { name: args.name } : {}),
    }),
});

export { getCookies };
