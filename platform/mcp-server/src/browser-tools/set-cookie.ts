/**
 * browser_set_cookie — set a browser cookie.
 */

import { defineBrowserTool } from './definition.js';
import { safeUrl } from './url-validation.js';
import { dispatchToExtension } from '../extension-protocol.js';
import { z } from 'zod';

const setCookie = defineBrowserTool({
  name: 'browser_set_cookie',
  description:
    'Set a browser cookie. Creates a new cookie or overwrites an existing one with the same name, domain, and path.',
  input: z.object({
    url: safeUrl.describe('URL to associate the cookie with'),
    name: z.string().min(1).describe('Cookie name'),
    value: z.string().describe('Cookie value'),
    domain: z.string().optional().describe('Cookie domain — defaults to the URL domain'),
    path: z.string().optional().describe('Cookie path — defaults to /'),
    secure: z.boolean().optional().describe('Whether the cookie requires HTTPS'),
    httpOnly: z.boolean().optional().describe('Whether the cookie is HttpOnly'),
    expirationDate: z.number().optional().describe('Unix timestamp for cookie expiry — omit for session cookie'),
  }),
  handler: async (args, state) => {
    const params: Record<string, unknown> = {
      url: args.url,
      name: args.name,
      value: args.value,
    };
    if (args.domain !== undefined) params.domain = args.domain;
    if (args.path !== undefined) params.path = args.path;
    if (args.secure !== undefined) params.secure = args.secure;
    if (args.httpOnly !== undefined) params.httpOnly = args.httpOnly;
    if (args.expirationDate !== undefined) params.expirationDate = args.expirationDate;
    return dispatchToExtension(state, 'browser.setCookie', params);
  },
});

export { setCookie };
