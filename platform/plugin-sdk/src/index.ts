import type { ConfigSchema } from '@opentabs-dev/shared';
import type { z } from 'zod';
import type { LucideIconName } from './lucide-icon-names.js';

// ---------------------------------------------------------------------------
// Re-exports from @opentabs-dev/shared (single source of truth)
// ---------------------------------------------------------------------------

export type {
  ConfigSchema,
  ConfigSettingDefinition,
  ConfigSettingType,
  ManifestTool,
  PluginManifest as Manifest,
} from '@opentabs-dev/shared';
export { NAME_REGEX, RESERVED_NAMES, validatePluginName, validateUrlPattern } from '@opentabs-dev/shared';
export type { LucideIconName } from './lucide-icon-names.js';
export { LUCIDE_ICON_NAMES } from './lucide-icon-names.js';

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

/** Options for reporting incremental progress during long-running tool operations. */
export interface ProgressOptions {
  /** Current progress value (e.g., 3 of 10 items processed). Omit for indeterminate progress. */
  progress?: number;
  /** Total expected value (e.g., 10 items total). Omit for indeterminate progress. */
  total?: number;
  /** Optional human-readable message describing the current step. */
  message?: string;
}

/** Context object injected into tool handlers at runtime by the adapter. */
export interface ToolHandlerContext {
  /** Report incremental progress during a long-running operation. Fire-and-forget. */
  reportProgress(opts: ProgressOptions): void;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition<
  TInput extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodType = z.ZodType,
> {
  /** Tool name — auto-prefixed with plugin name (e.g., 'send_message' → 'slack_send_message') */
  name: string;
  /** Human-readable display name shown in the side panel (e.g., 'Send Message'). Auto-derived from name during build when omitted. */
  displayName?: string;
  /** Human-readable description shown to MCP clients / AI agents */
  description: string;
  /** Short human-readable summary for the UI. Falls back to description if omitted. */
  summary?: string;
  /** Lucide icon name (kebab-case) displayed in the side panel. Defaults to 'wrench' during build when omitted. See https://lucide.dev/icons */
  icon?: LucideIconName;
  /** Optional group name for visual grouping in the side panel. Tools with the same group are rendered together under a section header. */
  group?: string;
  /** Zod schema — used for MCP registration + server-side input validation */
  input: TInput;
  /** Zod schema describing the tool output shape. Used for manifest generation and MCP tool registration. */
  output: TOutput;
  /** Execute the tool. Runs in the browser page context. Input is pre-validated. Context is injected by the adapter runtime. */
  handle(params: z.infer<TInput>, context?: ToolHandlerContext): Promise<z.infer<TOutput>>;
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
  /** Brief description of the plugin's purpose */
  abstract readonly description: string;
  /**
   * Chrome match patterns — determines which tabs get the adapter injected.
   * @see https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
   */
  abstract readonly urlPatterns: string[];
  /**
   * Chrome match patterns for URLs that should NOT match this plugin.
   * Tabs matching both urlPatterns and excludePatterns are excluded.
   * Useful when a broad urlPattern overlaps with another plugin's domain.
   * @see https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
   */
  readonly excludePatterns?: string[];
  /**
   * URL to open when no matching tab exists and the user triggers an
   * 'open tab' action from the side panel. Should be a concrete URL
   * (e.g., 'https://github.com'), not a match pattern.
   */
  readonly homepage?: string;
  /** Typed configuration schema — declares settings that users provide via config.json or the side panel. */
  readonly configSchema?: ConfigSchema;
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
  /**
   * Called once after the adapter is registered on
   * `globalThis.__openTabs.adapters`. Use for setting up page-level event
   * listeners, observers, or other resources that should exist for the
   * adapter's lifetime.
   */
  onActivate?(): void;
  /**
   * Called when the adapter is being removed — either before `teardown()`
   * on plugin update, or when the tab navigates away from a matching URL.
   * Use for cleanup of resources set up in `onActivate`.
   *
   * Ordering: `onDeactivate` fires before `teardown` when both are defined.
   */
  onDeactivate?(): void;
  /**
   * Called on in-page URL changes (pushState, replaceState, popstate,
   * hashchange). Runs in the page context. If the plugin does not
   * implement this method, no navigation listeners are set up.
   *
   * @param url — the new URL after the navigation (window.location.href)
   */
  onNavigate?(url: string): void;
  /**
   * Called before each `tool.handle()` execution. Runs in the page context.
   * Receives the tool name (unprefixed, e.g. "send_message" not
   * "slack_send_message"). Errors thrown here are caught and logged — they
   * do not prevent tool execution.
   *
   * @param toolName — the unprefixed tool name
   */
  onToolInvocationStart?(toolName: string): void;
  /**
   * Called after each `tool.handle()` completes, whether it succeeded or
   * threw. Receives the tool name, a boolean indicating success, and the
   * wall-clock duration in milliseconds. Errors thrown here are caught and
   * logged.
   *
   * @param toolName — the unprefixed tool name
   * @param success — true if handle() resolved, false if it threw
   * @param durationMs — wall-clock time of tool.handle() in milliseconds
   */
  onToolInvocationEnd?(toolName: string, success: boolean, durationMs: number): void;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type { ErrorCategory, ToolErrorOptions } from './errors.js';
export { ToolError } from './errors.js';

// ---------------------------------------------------------------------------
// SDK utilities — DOM
// ---------------------------------------------------------------------------

export type { ObserveDOMOptions, WaitForSelectorOptions } from './dom.js';
export {
  getMetaContent,
  getTextContent,
  observeDOM,
  querySelectorAll,
  waitForSelector,
  waitForSelectorRemoval,
} from './dom.js';

// ---------------------------------------------------------------------------
// SDK utilities — Fetch
// ---------------------------------------------------------------------------

export type {
  DeleteJSON,
  FetchFromPageOptions,
  FetchJSON,
  PatchJSON,
  PostForm,
  PostFormData,
  PostJSON,
  PutJSON,
} from './fetch.js';
export {
  buildQueryString,
  deleteJSON,
  fetchFromPage,
  fetchJSON,
  fetchJSONImpl,
  fetchText,
  httpStatusToToolError,
  parseRateLimitHeader,
  parseRetryAfterMs,
  patchJSON,
  postForm,
  postFormData,
  postJSON,
  putJSON,
  stripUndefined,
} from './fetch.js';

// ---------------------------------------------------------------------------
// SDK utilities — Timing
// ---------------------------------------------------------------------------

export type { RetryOptions, SleepOptions, WaitUntilOptions } from './timing.js';
export { retry, sleep, waitUntil } from './timing.js';

// ---------------------------------------------------------------------------
// SDK utilities — Storage
// ---------------------------------------------------------------------------

export {
  clearAuthCache,
  findLocalStorageEntry,
  getAuthCache,
  getCookie,
  getLocalStorage,
  getSessionStorage,
  removeLocalStorage,
  removeSessionStorage,
  setAuthCache,
  setLocalStorage,
  setSessionStorage,
} from './storage.js';

// ---------------------------------------------------------------------------
// SDK utilities — Config
// ---------------------------------------------------------------------------

export { getConfig } from './config.js';

// ---------------------------------------------------------------------------
// SDK utilities — Page State
// ---------------------------------------------------------------------------

export { getCurrentUrl, getPageGlobal, getPageTitle } from './page-state.js';

// ---------------------------------------------------------------------------
// SDK utilities — Pre-Script
// ---------------------------------------------------------------------------

export { getPreScriptValue } from './pre-script-reader.js';

// ---------------------------------------------------------------------------
// SDK utilities — Logging
// ---------------------------------------------------------------------------

export type { LogEntry, LogLevel, LogTransport } from './log.js';
export { log } from './log.js';

// ---------------------------------------------------------------------------
// SDK utilities — Readiness
// ---------------------------------------------------------------------------

export { notifyReadinessChanged } from './readiness.js';
