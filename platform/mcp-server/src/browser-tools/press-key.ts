/**
 * browser_press_key — dispatch keyboard events on a page element or the active element.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const pressKey = defineBrowserTool({
  name: 'browser_press_key',
  description:
    'Press a keyboard key on the page. Dispatches trusted (isTrusted: true) keyboard events via Chrome DevTools ' +
    'Protocol Input.dispatchKeyEvent. Named keys (Enter, Escape, etc.) dispatch rawKeyDown + keyUp; printable ' +
    'characters dispatch keyDown (carrying the text) + keyUp, so each is typed once. Common use cases: Enter to submit forms, Escape to close ' +
    'modals/dialogs, Tab to move between fields, arrow keys to navigate custom menus/dropdowns, Ctrl+K or Cmd+K ' +
    'for search. Supports Ctrl and Meta (Cmd) as independent modifiers. Uses standard KeyboardEvent.key values.',
  summary: 'Press a keyboard key on the page',
  icon: 'command',
  group: 'Page Interaction',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID of the page to interact with'),
    key: z
      .string()
      .min(1)
      .describe(
        'Key name using standard KeyboardEvent.key values (e.g., "Enter", "Escape", "Tab", "ArrowDown", "a", "1", " ")',
      ),
    selector: z
      .string()
      .min(1)
      .optional()
      .describe(
        'CSS selector of element to focus before pressing key. If omitted, dispatches to document.activeElement.',
      ),
    modifiers: z
      .object({
        shift: z.boolean().optional().describe('Hold Shift'),
        ctrl: z.boolean().optional().describe('Hold Ctrl'),
        alt: z.boolean().optional().describe('Hold Alt'),
        meta: z.boolean().optional().describe('Hold Meta (Cmd on macOS, Win on Windows)'),
      })
      .optional()
      .describe('Modifier keys to hold while pressing the key'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.pressKey', {
      tabId: args.tabId,
      key: args.key,
      ...(args.selector !== undefined ? { selector: args.selector } : {}),
      ...(args.modifiers !== undefined ? { modifiers: args.modifiers } : {}),
    }),
});

export { pressKey };
