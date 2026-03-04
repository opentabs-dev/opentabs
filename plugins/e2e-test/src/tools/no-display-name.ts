import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

/**
 * Minimal tool for E2E testing — verifies a simple tool with no parameters works.
 */
export const noDisplayName = defineTool({
  name: 'no_display_name',
  displayName: 'No Display Name',
  description: 'Minimal tool for E2E testing',
  summary: 'Minimal test tool',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  handle: async () => ({ ok: true }),
});
