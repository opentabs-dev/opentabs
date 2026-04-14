/**
 * browser_notify — show a Chrome desktop notification via the extension.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const showNotification = defineBrowserTool({
  name: 'browser_notify',
  description:
    'Show a Chrome desktop notification. Use this to alert the user about completed tasks, errors, or important events. ' +
    'The notification appears even when Chrome is in the background. ' +
    'If url is provided, clicking the notification opens that URL in a new tab; otherwise it opens the OpenTabs side panel.',
  summary: 'Show a desktop notification',
  icon: 'bell',
  group: 'Notifications',
  input: z.object({
    title: z.string().describe('Notification title'),
    message: z.string().describe('Notification body text'),
    iconUrl: z.string().url().optional().describe('Optional icon URL (defaults to the OpenTabs extension icon)'),
    requireInteraction: z
      .boolean()
      .optional()
      .describe('If true, the notification stays visible until the user clicks or dismisses it (default: false)'),
    contextMessage: z.string().optional().describe('Optional secondary text shown below the main message'),
    url: z.string().url().optional().describe('Optional URL to open when the notification is clicked'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.showNotification', args),
});

export { showNotification };
