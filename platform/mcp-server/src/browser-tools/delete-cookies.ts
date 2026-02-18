/**
 * browser_delete_cookies — delete a specific browser cookie by URL and name.
 */

import { defineBrowserTool } from './definition.js';
import { safeUrl } from './url-validation.js';
import { dispatchToExtension } from '../extension-protocol.js';
import { z } from 'zod';

const deleteCookies = defineBrowserTool({
  name: 'browser_delete_cookies',
  description: 'Delete a specific browser cookie by URL and name.',
  input: z.object({
    url: safeUrl.describe('URL of the cookie to delete'),
    name: z.string().min(1).describe('Name of the cookie to delete'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.deleteCookies', { url: args.url, name: args.name }),
});

export { deleteCookies };
