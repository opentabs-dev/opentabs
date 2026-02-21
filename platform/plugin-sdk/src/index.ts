import type { LucideIconName } from './lucide-icon-names.js';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Re-exports from @opentabs-dev/shared (single source of truth)
// ---------------------------------------------------------------------------

export { NAME_REGEX, RESERVED_NAMES, validatePluginName, validateUrlPattern } from '@opentabs-dev/shared';
export type { ManifestTool, PluginManifest as Manifest } from '@opentabs-dev/shared';
export type { LucideIconName } from './lucide-icon-names.js';
export { LUCIDE_ICON_NAMES } from './lucide-icon-names.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition<
  TInput extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodType = z.ZodType,
> {
  /** Tool name — auto-prefixed with plugin name (e.g., 'send_message' → 'slack_send_message') */
  name: string;
  /** Human-readable display name shown in the side panel (e.g., 'Send Message') */
  displayName: string;
  /** Human-readable description shown to MCP clients / AI agents */
  description: string;
  /** Lucide icon name (kebab-case) displayed in the side panel. See https://lucide.dev/icons */
  icon: LucideIconName;
  /** Zod schema — used for MCP registration + server-side input validation */
  input: TInput;
  /** Zod schema describing the tool output shape. Used for manifest generation and MCP tool registration. */
  output: TOutput;
  /** Execute the tool. Runs in the browser page context. Input is pre-validated. */
  handle(params: z.infer<TInput>): Promise<z.infer<TOutput>>;
}

/** Type-safe factory — identity function that provides generic inference */
export const defineTool = <TInput extends z.ZodObject<z.ZodRawShape>, TOutput extends z.ZodType>(
  config: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> => config;

/**
 * Abstract base class for all OpenTabs plugins.
 * Plugin authors extend this and export an instance.
 */
export abstract class OpenTabsPlugin {
  /** Unique identifier (lowercase alphanumeric + hyphens) */
  abstract readonly name: string;
  /** Semver version string */
  abstract readonly version: string;
  /** Brief description of the plugin's purpose */
  abstract readonly description: string;
  /**
   * Chrome match patterns — determines which tabs get the adapter injected.
   * @see https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
   */
  abstract readonly urlPatterns: string[];
  /** All tool definitions for this plugin */
  abstract readonly tools: ToolDefinition[];
  /**
   * Readiness probe (Kubernetes convention).
   * Called by the extension to determine if the service in the current
   * tab is ready to accept tool requests. Runs in the page context.
   *
   * Tab state mapping:
   *   - No matching tab exists     → 'closed'
   *   - Tab exists, isReady=false  → 'unavailable'
   *   - Tab exists, isReady=true   → 'ready'
   *
   * @returns true if the user is authenticated and the service is operational
   */
  abstract isReady(): Promise<boolean>;
  /** Human-readable display name shown in the side panel and health endpoint */
  abstract readonly displayName: string;
  /**
   * Called by the platform before re-injection (plugin.update) to allow
   * cleanup of event listeners, timers, or global state set up by the
   * previous adapter version. Optional — plugins that do not set up
   * persistent side effects can omit this.
   */
  teardown?(): void;
}

/**
 * Typed error for tool handlers — the platform catches these
 * and returns structured MCP error responses.
 */
// ---------------------------------------------------------------------------
// SDK utilities — DOM
// ---------------------------------------------------------------------------

export { waitForSelector, waitForSelectorRemoval, querySelectorAll, getTextContent, observeDOM } from './dom.js';
export type { WaitForSelectorOptions, ObserveDOMOptions } from './dom.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ToolError extends Error {
  constructor(
    message: string,
    /** Machine-readable error code (e.g., 'CHANNEL_NOT_FOUND') */
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
