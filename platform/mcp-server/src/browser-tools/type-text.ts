/**
 * browser_type_text — type text into an input field or textarea.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const typeText = defineBrowserTool({
  name: 'browser_type_text',
  description:
    'Type text into an input, textarea or contenteditable element matching the CSS selector. In one page script it ' +
    'focuses the element, selects the existing content when clear is true (otherwise puts the caret at the end), ' +
    "and inserts the text with document.execCommand('insertText'), the browser's own editing path, so React and " +
    'other framework-controlled inputs see it. Where that is unavailable it uses the native value setter plus ' +
    'input and change events. Fails on a disabled, read-only or unfocusable element.',
  summary: 'Type text into an input field',
  icon: 'keyboard',
  group: 'Page Interaction',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID of the page to interact with'),
    selector: z.string().min(1).describe('CSS selector of the input or textarea'),
    text: z.string().describe('Text to enter into the element'),
    clear: z.boolean().optional().describe('Clear existing value before typing — defaults to true'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.typeText', {
      tabId: args.tabId,
      selector: args.selector,
      text: args.text,
      clear: args.clear ?? true,
    }),
});

export { typeText };
