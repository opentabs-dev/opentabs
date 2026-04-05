/**
 * extension_check_adapter — checks the adapter injection status for a specific
 * plugin across all matching tabs in all connected browser profiles. Reports
 * whether the adapter is present, its hash, readiness, and tool count for each
 * tab, with results annotated per-profile.
 */

import { z } from 'zod';
import { dispatchToAllConnections } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const extensionCheckAdapter = defineBrowserTool({
  name: 'extension_check_adapter',
  description:
    'Check the adapter injection status for a specific plugin across all matching tabs in all connected browser profiles. ' +
    'For each profile, reports per-tab adapter status: whether the adapter IIFE is present, ' +
    'its hash, whether the hash matches the expected value, isReady() result, tool count, and tool names. ' +
    "Use this tool to diagnose why a plugin's tools are failing — common issues include adapter not injected, " +
    'stale adapter hash, or isReady() returning false.',
  summary: 'Check plugin adapter injection status (all profiles)',
  icon: 'plug',
  group: 'Extension',
  input: z.object({
    plugin: z.string().describe('The plugin name to check (e.g., "slack", "e2e-test")'),
  }),
  handler: async (args, state) => {
    const results = await dispatchToAllConnections(state, 'extension.checkAdapter', { plugin: args.plugin });
    return {
      connections: results.map(r => {
        const obj =
          r.result !== null && typeof r.result === 'object' && !Array.isArray(r.result)
            ? (r.result as Record<string, unknown>)
            : {};
        return { connectionId: r.connectionId, ...obj };
      }),
    };
  },
});

export { extensionCheckAdapter };
