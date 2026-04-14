/**
 * browser_force_pseudo_state — force CSS pseudo-class states on a DOM element via CDP.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const forcePseudoState = defineBrowserTool({
  name: 'browser_force_pseudo_state',
  description:
    'Force CSS pseudo-class states (:hover, :focus, :active, :visited, :focus-within, :focus-visible) ' +
    'on a DOM element identified by a CSS selector. The forced state persists until cleared by calling ' +
    'with an empty pseudoClasses array, or until the debugger session ends. ' +
    'Useful for inspecting hover/focus styles without manual interaction.',
  summary: 'Force CSS pseudo-states on an element',
  icon: 'paintbrush',
  group: 'Inspection',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID to operate on'),
    selector: z.string().describe('CSS selector identifying the target element'),
    pseudoClasses: z
      .array(z.enum([':hover', ':focus', ':active', ':visited', ':focus-within', ':focus-visible']))
      .describe('Pseudo-classes to force (pass empty array to clear)'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.forcePseudoState', {
      tabId: args.tabId,
      selector: args.selector,
      pseudoClasses: args.pseudoClasses,
    }),
});

export { forcePseudoState };
