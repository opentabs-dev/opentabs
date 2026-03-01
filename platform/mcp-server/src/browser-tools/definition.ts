/**
 * Type foundation for browser tools.
 * Browser tools run chrome.* APIs via the extension's background script,
 * bypassing the plugin adapter/tab lifecycle entirely.
 *
 * Hot reload atomicity invariant:
 *   Browser tool handlers are replaced atomically on each hot reload via
 *   `state.browserTools = browserTools` in reload.ts. Consumers (mcp-setup.ts)
 *   read from `state.browserTools` at call time inside the tools/call handler,
 *   so they always see the latest definitions. Never cache the browserTools
 *   array or individual handler references outside of a single request scope.
 */

import type { ServerState } from '../state.js';
import type { z } from 'zod';

/** A browser tool definition with Zod input schema and a handler */
interface BrowserToolDefinition<TInput extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  /** Lucide icon name (kebab-case) displayed in the side panel. Defaults to 'globe' if omitted. */
  icon?: string;
  input: TInput;
  handler: (args: z.infer<TInput>, state: ServerState) => Promise<unknown>;
}

/** Type-safe factory for defining browser tools */
const defineBrowserTool = <TInput extends z.ZodObject>(
  config: BrowserToolDefinition<TInput>,
): BrowserToolDefinition<TInput> => config;

export type { BrowserToolDefinition };
export { defineBrowserTool };
