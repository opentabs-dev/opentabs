/**
 * browser_get_element_styles — retrieve computed and matched CSS styles for an element via CDP.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const getElementStyles = defineBrowserTool({
  name: 'browser_get_element_styles',
  description:
    'Get computed CSS styles and matched CSS rules for a DOM element identified by a CSS selector. ' +
    'Returns the full set of computed style properties and the matched CSS rules with selectors, ' +
    'property values, source stylesheet URLs, and line numbers. ' +
    'Requires the Chrome DevTools Protocol DOM and CSS domains.',
  summary: 'Get computed and matched CSS styles for an element',
  icon: 'paintbrush',
  group: 'Inspection',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to inspect'),
    selector: z.string().describe('CSS selector identifying the target element'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.getElementStyles', {
      tabId: args.tabId,
      selector: args.selector,
    }),
});

export { getElementStyles };
