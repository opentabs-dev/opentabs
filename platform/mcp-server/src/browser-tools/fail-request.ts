/**
 * browser_fail_request — fail a paused request with an error reason.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const failRequest = defineBrowserTool({
  name: 'browser_fail_request',
  description:
    'Fail a paused HTTP request with a network error. The request must have been paused by browser_intercept_requests. ' +
    'Use this to simulate network failures, blocked requests, or connection errors.',
  summary: 'Fail a paused request with an error',
  icon: 'route',
  group: 'Network',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID where the request is paused'),
    requestId: z.string().describe('Request ID from a paused request'),
    errorReason: z
      .enum([
        'Failed',
        'Aborted',
        'TimedOut',
        'AccessDenied',
        'ConnectionClosed',
        'ConnectionRefused',
        'ConnectionReset',
      ])
      .optional()
      .describe('Error reason (default: Failed)'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.failRequest', {
      tabId: args.tabId,
      requestId: args.requestId,
      ...(args.errorReason !== undefined ? { errorReason: args.errorReason } : {}),
    }),
});

export { failRequest };
