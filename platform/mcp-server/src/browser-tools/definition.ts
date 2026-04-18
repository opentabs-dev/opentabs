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

import type { z } from 'zod';
import type { ServerState } from '../state.js';

/** Text content part — JSON-stringified handler output is wrapped in this by default */
interface TextContentPart {
  type: 'text';
  text: string;
}

/**
 * Image content part — used by tools that return binary image data (e.g. screenshots).
 * MCP clients decode this directly, so the payload is not subject to text-result spilling.
 */
interface ImageContentPart {
  type: 'image';
  data: string;
  mimeType: string;
}

/** Union of content parts a browser tool may produce via formatResult */
type ToolContentPart = TextContentPart | ImageContentPart;

/** A browser tool definition with Zod input schema and a handler */
interface BrowserToolDefinition<TInput extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  /** Short human-readable summary for the UI. Falls back to description if omitted. */
  summary?: string;
  /** Lucide icon name (kebab-case) displayed in the side panel. Defaults to 'globe' if omitted. */
  icon?: string;
  /** Logical group name for displaying this tool in the side panel (e.g. 'Tabs', 'Network'). */
  group?: string;
  input: TInput;
  handler: (args: z.infer<TInput>, state: ServerState) => Promise<unknown>;
  /**
   * Optional formatter that converts the sanitized handler result into MCP content parts.
   * When omitted, the dispatcher wraps the JSON-stringified result as a single text part.
   * Tools that return binary payloads (images, audio) define this to emit the appropriate
   * MCP content part directly, avoiding the text-payload path that triggers client-side
   * spill-to-file when results exceed inline size caps.
   */
  formatResult?: (result: unknown) => ToolContentPart[];
}

/** Type-safe factory for defining browser tools */
const defineBrowserTool = <TInput extends z.ZodObject>(
  config: BrowserToolDefinition<TInput>,
): BrowserToolDefinition<TInput> => config;

export type { BrowserToolDefinition, ImageContentPart, TextContentPart, ToolContentPart };
export { defineBrowserTool };
