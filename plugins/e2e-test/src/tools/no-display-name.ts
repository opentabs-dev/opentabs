import { defineTool } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

/**
 * Tool that deliberately omits displayName and icon to verify the build
 * auto-derives sensible defaults: displayName from snake_case name → Title Case,
 * icon defaults to 'wrench'.
 *
 * The published SDK (v0.0.16) still requires displayName and icon at the type
 * level. The local source has made them optional (for the auto-derive feature
 * in PRD 4 US-004). A type assertion bypasses the published type constraint
 * so the runtime omission is genuine — the build tool fills in defaults.
 */
export const noDisplayName = defineTool({
  name: 'no_display_name',
  description: 'Tool with no explicit displayName or icon — tests auto-derivation of defaults',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  handle: async () => ({ ok: true }),
} as unknown as ToolDefinition);
