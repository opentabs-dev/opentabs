import type { z } from 'zod'

export interface ToolDefinition<
  TInput extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodType = z.ZodType,
> {
  /** Tool name — auto-prefixed with plugin name (e.g., 'send_message' → 'slack_send_message') */
  name: string
  /** Human-readable description shown to MCP clients / AI agents */
  description: string
  /** Zod schema — used for MCP registration + server-side input validation */
  input: TInput
  /** Zod schema — used for server-side output validation */
  output: TOutput
  /** Execute the tool. Runs in the browser page context. Input is pre-validated. */
  handle(params: z.infer<TInput>): Promise<z.infer<TOutput>>
}

/** Type-safe factory — identity function that provides generic inference */
export const defineTool = <
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodType,
>(
  config: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> => config

/**
 * Abstract base class for all OpenTabs plugins.
 * Plugin authors extend this and export an instance.
 */
export abstract class OpenTabsPlugin {
  /** Unique identifier (lowercase alphanumeric + hyphens) */
  abstract readonly name: string
  /** Semver version string */
  abstract readonly version: string
  /** Brief description of the plugin's purpose */
  abstract readonly description: string
  /**
   * Chrome match patterns — determines which tabs get the adapter injected.
   * @see https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
   */
  abstract readonly urlPatterns: string[]
  /** All tool definitions for this plugin */
  abstract readonly tools: ToolDefinition[]
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
  abstract isReady(): Promise<boolean>
  /** Human-readable display name. Defaults to `name` if not set. */
  displayName?: string
}

/**
 * Typed error for tool handlers — the platform catches these
 * and returns structured MCP error responses.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    /** Machine-readable error code (e.g., 'CHANNEL_NOT_FOUND') */
    public readonly code: string,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}
