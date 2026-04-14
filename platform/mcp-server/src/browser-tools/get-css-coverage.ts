/**
 * browser_get_css_coverage — measure CSS rule usage on a page via CDP.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const getCssCoverage = defineBrowserTool({
  name: 'browser_get_css_coverage',
  description:
    'Start CSS rule usage tracking, wait for page activity, then report which CSS rules are used ' +
    'versus unused. Returns per-stylesheet usage percentages and total page-wide coverage. ' +
    'Useful for identifying dead CSS and optimizing stylesheets.',
  summary: 'Get CSS coverage (used vs unused rules)',
  icon: 'paintbrush',
  group: 'Inspection',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to analyze'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.getCssCoverage', {
      tabId: args.tabId,
    }),
});

export { getCssCoverage };
