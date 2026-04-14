/**
 * browser_audit_page — detect page issues (mixed content, CORS, CSP,
 * deprecated APIs, cookie warnings) using the CDP Audits domain.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const auditPage = defineBrowserTool({
  name: 'browser_audit_page',
  description:
    'Audit a browser tab for page issues using the Chrome DevTools Protocol Audits domain. ' +
    'Detects mixed content, CORS errors, Content Security Policy violations, cookie warnings, ' +
    'deprecated API usage, and other issues. Issues are grouped by category with severity, source file, ' +
    'and line number when available. Use waitSeconds to control how long to collect issues (default: 2s). ' +
    'Useful for diagnosing security issues, deprecation warnings, and compliance problems.',
  summary: 'Audit a page for issues',
  icon: 'shield-alert',
  group: 'Inspection',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID'),
    waitSeconds: z.number().min(1).max(30).optional().describe('Seconds to collect issues (default: 2)'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.auditPage', {
      tabId: args.tabId,
      ...(args.waitSeconds !== undefined ? { waitSeconds: args.waitSeconds } : {}),
    }),
});

export { auditPage };
