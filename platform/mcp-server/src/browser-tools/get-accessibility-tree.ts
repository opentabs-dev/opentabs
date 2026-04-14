/**
 * browser_get_accessibility_tree — retrieve the accessibility tree for a tab
 * using the CDP Accessibility domain.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const getAccessibilityTree = defineBrowserTool({
  name: 'browser_get_accessibility_tree',
  description:
    'Get the accessibility tree for a browser tab using the Chrome DevTools Protocol. ' +
    'Returns a flat array of accessibility nodes with role, name, value, description, and states. ' +
    'Useful for understanding page structure, verifying accessibility compliance, and finding interactive elements. ' +
    'Large trees are truncated to 2000 nodes. Use the depth parameter to limit tree depth, ' +
    'or interestingOnly (default: true) to filter out nodes without semantic content.',
  summary: 'Get the accessibility tree for a tab',
  icon: 'accessibility',
  group: 'Accessibility',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID'),
    depth: z.number().int().min(1).max(50).optional().describe('Max tree depth (default: full tree)'),
    interestingOnly: z.boolean().optional().describe('Only return nodes with semantic content (default: true)'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.getAccessibilityTree', {
      tabId: args.tabId,
      ...(args.depth !== undefined ? { depth: args.depth } : {}),
      ...(args.interestingOnly !== undefined ? { interestingOnly: args.interestingOnly } : {}),
    }),
});

export { getAccessibilityTree };
