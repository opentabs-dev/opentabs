/**
 * browser_fulfill_request — fulfill a paused request with a custom response.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const fulfillRequest = defineBrowserTool({
  name: 'browser_fulfill_request',
  description:
    'Fulfill a paused HTTP request with a custom response. The request must have been paused by browser_intercept_requests. ' +
    'Provide the requestId from the paused request, an HTTP status code, optional response headers, and optional body.',
  summary: 'Fulfill a paused request with a custom response',
  icon: 'route',
  group: 'Network',
  input: z.object({
    tabId: z.number().int().positive().describe('Tab ID where the request is paused'),
    requestId: z.string().describe('Request ID from a paused request'),
    status: z.number().int().min(100).max(599).describe('HTTP status code'),
    headers: z.record(z.string(), z.string()).optional().describe('Response headers'),
    body: z.string().optional().describe('Response body'),
  }),
  handler: async (args, state) =>
    dispatchToExtension(state, 'browser.fulfillRequest', {
      tabId: args.tabId,
      requestId: args.requestId,
      status: args.status,
      ...(args.headers !== undefined ? { headers: args.headers } : {}),
      ...(args.body !== undefined ? { body: args.body } : {}),
    }),
});

export { fulfillRequest };
