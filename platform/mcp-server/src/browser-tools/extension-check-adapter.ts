/**
 * extension_check_adapter — checks the adapter injection status for a specific
 * plugin across all matching tabs. Reports whether the adapter is present,
 * its hash, readiness, and tool count for each tab.
 */

import { defineBrowserTool } from './definition.js';
import { dispatchToExtension } from '../extension-protocol.js';
import { z } from 'zod';

const extensionCheckAdapter = defineBrowserTool({
  name: 'extension_check_adapter',
  description:
    'Check the adapter injection status for a specific plugin across all matching tabs. ' +
    'For each tab matching the plugin URL patterns, reports whether the adapter IIFE is present, ' +
    'its hash, whether the hash matches the expected value, isReady() result, tool count, and tool names. ' +
    "Use this tool to diagnose why a plugin's tools are failing — common issues include adapter not injected, " +
    'stale adapter hash, or isReady() returning false.',
  input: z.object({
    plugin: z.string().describe('The plugin name to check (e.g., "slack", "e2e-test")'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'extension.checkAdapter', { plugin: args.plugin }),
});

export { extensionCheckAdapter };
