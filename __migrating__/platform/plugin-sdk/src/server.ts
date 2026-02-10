// =============================================================================
// @opentabs/plugin-sdk/server
//
// Utilities for MCP tool definitions. Plugin authors import from this module
// when writing their tool registration code (the code that runs inside the
// MCP server process and defines tools exposed to AI agents).
//
// This module provides:
// 1. A request provider pattern — plugins call sendServiceRequest() which
//    delegates to the MCP server's WebSocket relay. The relay is injected
//    at startup by the platform, not imported directly by plugins.
// 2. Tool registration helpers — createToolRegistrar() and defineTool()
//    eliminate boilerplate from tool definitions.
// 3. Response formatting — success() and error() produce the ToolResult
//    shape expected by the MCP protocol.
// 4. AsyncLocalStorage-based tool ID tracking — the current tool's name
//    is available in nested async calls for permission enforcement.
// 5. Extensible error pattern registry — plugins register domain-specific
//    error patterns for user-friendly error messages.
//
// Usage in a plugin's tools module:
//
//   import { createToolRegistrar, sendServiceRequest, success } from '@opentabs/plugin-sdk/server';
//   import { z } from 'zod';
//   import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
//
//   export const registerTools = (server: McpServer): Map<string, RegisteredTool> => {
//     const { tools, define } = createToolRegistrar(server);
//
//     define('my_tool', {
//       description: 'Does something useful',
//       inputSchema: { query: z.string() },
//     }, async ({ query }) => {
//       const result = await sendServiceRequest('my-service', { endpoint: '/api', method: 'GET' });
//       return success(result);
//     });
//
//     return tools;
//   };
//
// =============================================================================

import { isJsonRpcError } from '@opentabs/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpServer, RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { NativeApiPermission } from '@opentabs/core';

// =============================================================================
// Tool Result Types
// =============================================================================

/** The standard shape returned by every MCP tool handler. */
interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// =============================================================================
// Request Provider — Dependency Injection for Plugin ↔ Relay Communication
//
// Plugins cannot import the WebSocket relay directly — it's internal to the
// MCP server. Instead, the MCP server registers a request provider at startup,
// and the SDK delegates all requests through it.
//
// This decoupling means:
// - Plugin code has zero imports from @opentabs/mcp-server
// - The transport layer can be swapped without touching plugins
// - Testing is trivial: inject a mock provider
// =============================================================================

/**
 * The transport interface that the MCP server implements.
 * Plugins interact with the Chrome extension exclusively through this.
 */
interface RequestProvider {
  /**
   * Send a request to a webapp service adapter running in a browser tab.
   * @param service - The service/plugin name (e.g. 'slack', 'jira')
   * @param params - JSON-RPC params to send to the adapter
   * @param action - The adapter action (default: 'api')
   */
  sendServiceRequest: (service: string, params: Record<string, unknown>, action?: string) => Promise<unknown>;

  /**
   * Send a request to the browser controller (chrome.tabs/windows APIs).
   * Only available to plugins that declare 'browser' in permissions.nativeApis.
   */
  sendBrowserRequest: <T>(action: string, params?: Record<string, unknown>) => Promise<T>;

  /**
   * Reload the Chrome extension. Platform-internal — not exposed to plugins.
   */
  reloadExtension: () => Promise<{ reloading: boolean }>;
}

/** The registered request provider, set by the MCP server at startup. */
let provider: RequestProvider | null = null;

/**
 * Register the request provider. Called by the MCP server during initialization.
 *
 * This is a platform-internal function — plugin authors should never call it.
 * It's prefixed with `__` to signal it's not part of the public plugin API.
 *
 * @param requestProvider - The transport implementation (typically wraps the WebSocket relay)
 */
const __setRequestProvider = (requestProvider: RequestProvider): void => {
  provider = requestProvider;
};

/**
 * Get the current request provider. Throws if not initialized.
 * Used internally by the SDK's request functions.
 */
const getProvider = (): RequestProvider => {
  if (!provider) {
    throw new Error(
      'OpenTabs SDK not initialized: no request provider registered. ' +
        'This function must be called within a tool handler running inside the MCP server. ' +
        'If you are writing tests, use @opentabs/plugin-test-utils to set up a mock provider.',
    );
  }
  return provider;
};

/**
 * Reset the request provider to null. Used only in tests.
 */
const __resetRequestProvider = (): void => {
  provider = null;
};

// =============================================================================
// Tool ID Tracking — AsyncLocalStorage
//
// Each tool invocation runs inside an AsyncLocalStorage context that carries
// the tool's name. This allows nested async calls (like sendServiceRequest)
// to automatically include the tool ID for permission checking in the
// extension's service controller.
// =============================================================================

const toolIdStorage = new AsyncLocalStorage<string>();

/** Get the current tool ID from async context. Returns undefined outside a tool handler. */
const getCurrentToolId = (): string | undefined => toolIdStorage.getStore();

/** Run a function within a tool ID context. Used by the tool registration wrapper. */
const withToolId = <T>(toolId: string, fn: () => T): T => toolIdStorage.run(toolId, fn);

// =============================================================================
// Permission Registry — Runtime nativeApis Enforcement
//
// The plugin-loader registers each plugin's declared nativeApis permissions
// via __registerPluginPermissions(). At runtime, sendBrowserRequest() checks
// the current tool's plugin against this registry and rejects calls from
// plugins that didn't declare 'browser' in their manifest.
//
// Platform-native tools (those with the PLATFORM_TOOL_PREFIX) bypass this
// check — they're part of the platform itself.
// =============================================================================

/** Prefix used by platform-native tool names (browser_*, reload_extension, capture_*, etc.). */
const PLATFORM_TOOL_PREFIXES = ['browser_', 'reload_extension', 'capture_'];

/**
 * Maps tool name prefixes (plugin names) to their allowed nativeApi permissions.
 * Example: { 'slack': new Set(), 'jira': new Set(['browser']) }
 */
const pluginPermissions = new Map<string, ReadonlySet<NativeApiPermission>>();

/**
 * Register a plugin's nativeApi permissions for runtime enforcement.
 *
 * Called by the MCP server's plugin initialization code after loading each
 * plugin. Maps tool names belonging to that plugin to the plugin's declared
 * nativeApis permissions set.
 *
 * @param pluginName - The plugin name (used as tool name prefix, e.g. 'slack')
 * @param nativeApis - The nativeApis permissions declared in the plugin's manifest
 */
const __registerPluginPermissions = (pluginName: string, nativeApis: readonly NativeApiPermission[]): void => {
  pluginPermissions.set(pluginName, new Set(nativeApis));
};

/**
 * Reset the permission registry. Used only in tests.
 */
const __resetPluginPermissions = (): void => {
  pluginPermissions.clear();
};

/**
 * Check whether the current tool has a specific nativeApi permission.
 * Platform-native tools always have permission. Plugin tools are checked
 * against the permission registry populated during plugin initialization.
 *
 * @param permission - The nativeApi permission to check (e.g. 'browser')
 * @returns true if allowed, false if denied
 */
const hasNativeApiPermission = (permission: NativeApiPermission): boolean => {
  const toolId = getCurrentToolId();

  // Outside a tool context (e.g. during initialization) — allow
  if (!toolId) return true;

  // Platform-native tools always have permission
  if (PLATFORM_TOOL_PREFIXES.some(prefix => toolId.startsWith(prefix))) return true;

  // Extract plugin name from tool ID (convention: <plugin>_<action>)
  const underscoreIndex = toolId.indexOf('_');
  const pluginName = underscoreIndex > 0 ? toolId.slice(0, underscoreIndex) : toolId;

  const permissions = pluginPermissions.get(pluginName);

  // If the plugin isn't registered, deny by default (fail-closed)
  if (!permissions) return false;

  return permissions.has(permission);
};

// =============================================================================
// Service Request Functions
//
// These are the primary API for plugin tools to communicate with their
// adapters running in the browser. Each function automatically injects
// the current tool ID for permission enforcement.
// =============================================================================

/**
 * Send a request to a webapp service adapter via the MCP server's relay.
 *
 * This is the primary communication channel between plugin tools and their
 * browser-side adapters. The request is routed through:
 *   MCP server → WebSocket → Chrome extension → adapter in page context
 *
 * @param service - The plugin/service name (must match the adapter's registered name)
 * @param params - Arbitrary params forwarded as JSON-RPC params to the adapter
 * @param action - The adapter action method (default: 'api')
 * @returns The adapter's response (the `result` field of a JSON-RPC success response)
 *
 * @example
 * ```ts
 * // Call a REST API through the adapter
 * const users = await sendServiceRequest('jira', {
 *   endpoint: '/rest/api/3/search',
 *   method: 'POST',
 *   body: { jql: 'project = ENG' },
 * });
 *
 * // Call with a custom action (e.g. Slack's Edge API)
 * const data = await sendServiceRequest('slack', {
 *   endpoint: 'users/search',
 *   params: { query: 'jane' },
 * }, 'edgeApi');
 * ```
 */
const sendServiceRequest = (service: string, params: Record<string, unknown>, action?: string): Promise<unknown> => {
  const toolId = getCurrentToolId();
  return getProvider().sendServiceRequest(service, { ...params, toolId }, action);
};

/**
 * Send a request to the browser controller (chrome.tabs/windows APIs).
 *
 * Requires the plugin to declare `nativeApis: ['browser']` in its manifest.
 * Without this permission, the request is rejected at runtime with a
 * descriptive error. Platform-native tools (browser_*, reload_extension)
 * bypass this check.
 *
 * @param action - The browser controller action (e.g. 'listTabs', 'openTab')
 * @param params - Action-specific parameters
 * @throws Error if the calling plugin lacks the 'browser' nativeApi permission
 */
const sendBrowserRequest = <T>(action: string, params?: Record<string, unknown>): Promise<T> => {
  if (!hasNativeApiPermission('browser')) {
    const toolId = getCurrentToolId() ?? 'unknown';
    return Promise.reject(
      new Error(
        `Permission denied: tool "${toolId}" called sendBrowserRequest() but its plugin ` +
          `does not declare 'browser' in permissions.nativeApis. Add it to opentabs-plugin.json.`,
      ),
    );
  }

  const toolId = getCurrentToolId();
  return getProvider().sendBrowserRequest<T>(action, {
    ...params,
    toolId,
  });
};

/**
 * Reload the Chrome extension. Platform-internal — typically used only by
 * the extension reload tool, not by plugin tools.
 */
const reloadExtension = (): Promise<{ reloading: boolean }> => getProvider().reloadExtension();

// =============================================================================
// Tool Result Formatting
// =============================================================================

/**
 * Format a successful tool result.
 *
 * Serializes the data as pretty-printed JSON inside an MCP text content block.
 * This is the standard return format for all OpenTabs tools.
 *
 * @param data - Any JSON-serializable value
 */
const success = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

/**
 * Format an error tool result with a user-friendly message.
 *
 * Applies error formatting (pattern matching on common error strings)
 * to produce actionable error messages for AI agents.
 *
 * @param err - The error to format (Error instance or any value)
 */
const error = (err: unknown): ToolResult => {
  const message = formatError(err);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
};

// =============================================================================
// Extensible Error Pattern Registry
//
// The SDK provides generic platform error patterns. Plugins can register
// additional domain-specific patterns for user-friendly error messages.
//
// Pattern matching runs in registration order: platform patterns first, then
// plugin patterns in the order they were registered. First match wins.
// =============================================================================

/** An error pattern: a predicate that matches error messages, and a formatter. */
interface ErrorPattern {
  match: (msg: string) => boolean;
  format: (msg: string) => string;
}

/**
 * Platform-level error patterns. These cover generic infrastructure errors
 * that apply to all plugins (connection issues, timeouts, HTTP status codes).
 */
const PLATFORM_ERROR_PATTERNS: ErrorPattern[] = [
  {
    match: msg => msg.includes('not connected'),
    format: () =>
      'Chrome extension not connected. Please ensure:\n' +
      '1. The OpenTabs extension is installed in Chrome\n' +
      '2. You have a service tab open\n' +
      '3. You are logged in\n' +
      '4. Click the extension icon to verify connection status',
  },
  {
    match: msg => msg.includes('timed out'),
    format: () => 'Request timed out. The API may be slow or the extension disconnected. Try refreshing the tab.',
  },
  {
    match: msg => msg.includes('Connection closed'),
    format: () => 'Connection to extension was lost. Please check that the tab is still open and refresh it if needed.',
  },
  {
    match: msg => msg.includes('401') || msg.includes('Unauthorized'),
    format: () => 'Unauthorized: This API requires elevated permissions not available via browser session.',
  },
  {
    match: msg => msg.includes('403') || msg.includes('Forbidden'),
    format: () => 'Forbidden: Your user account does not have permission to access this resource.',
  },
];

/** Plugin-registered error patterns. Appended via registerErrorPatterns(). */
const pluginErrorPatterns: ErrorPattern[] = [];

/**
 * Register additional error patterns for domain-specific error formatting.
 *
 * Plugins call this during tool registration to add patterns that match
 * errors specific to their service (e.g. Slack's `channel_not_found`,
 * Jira's `ISSUE_NOT_FOUND`).
 *
 * Patterns are checked after platform patterns. First match wins.
 *
 * @param patterns - Array of error patterns to register
 *
 * @example
 * ```ts
 * registerErrorPatterns([
 *   {
 *     match: msg => msg.includes('channel_not_found'),
 *     format: () => 'Channel not found. Check the channel name or ID.',
 *   },
 *   {
 *     match: msg => msg.includes('not_in_channel'),
 *     format: () => 'You are not a member of this channel.',
 *   },
 * ]);
 * ```
 */
const registerErrorPatterns = (patterns: ErrorPattern[]): void => {
  pluginErrorPatterns.push(...patterns);
};

/**
 * Reset plugin error patterns. Used only in tests.
 */
const __resetErrorPatterns = (): void => {
  pluginErrorPatterns.length = 0;
};

/**
 * Format an error into a user-friendly message.
 *
 * Applies pattern matching against platform patterns first, then plugin
 * patterns. If no pattern matches, returns the raw error message.
 *
 * @param err - The error to format
 * @returns A user-friendly error description
 */
const formatError = (err: unknown): string => {
  if (err instanceof Error) {
    const message = err.message;

    // Check platform patterns first
    for (const pattern of PLATFORM_ERROR_PATTERNS) {
      if (pattern.match(message)) return pattern.format(message);
    }

    // Check plugin-registered patterns
    for (const pattern of pluginErrorPatterns) {
      if (pattern.match(message)) return pattern.format(message);
    }

    return message;
  }

  return String(err);
};

// =============================================================================
// Tool Registration Helpers
//
// These eliminate the boilerplate from tool definitions:
// - Automatic withToolId wrapping (tool ID is available in nested async calls)
// - Automatic try/catch with error formatting
// - Curried server and tools map to avoid repetition
// =============================================================================

/**
 * Tool definition configuration.
 */
interface ToolConfig<InputArgs extends ZodRawShapeCompat> {
  /** Human-readable title (optional, shown in some MCP clients). */
  title?: string;
  /** Tool description — critical for AI agents to understand when to use it. */
  description?: string;
  /** Zod schema for the tool's input parameters. */
  inputSchema?: InputArgs;
  /** MCP tool annotations (e.g. readOnly, destructive). */
  annotations?: ToolAnnotations;
}

/**
 * Register a single tool on the MCP server with automatic withToolId wrapping
 * and error handling.
 *
 * The handler runs inside `withToolId(name, ...)` so that `getCurrentToolId()`
 * returns the tool name in all nested async calls. The handler is wrapped in a
 * try/catch that returns `error(err)` on failure.
 *
 * @param tools - The tools map to add the registration to
 * @param server - The MCP server instance
 * @param name - Unique tool name (convention: `<service>_<action>`)
 * @param config - Tool metadata and input schema
 * @param handler - The async function that implements the tool
 */
const defineTool = <InputArgs extends ZodRawShapeCompat>(
  tools: Map<string, RegisteredTool>,
  server: McpServer,
  name: string,
  config: ToolConfig<InputArgs>,
  handler: ToolCallback<InputArgs>,
): void => {
  const wrappedHandler: ToolCallback<InputArgs> = ((...args: unknown[]) =>
    withToolId(name, async () => {
      try {
        return await (handler as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (err) {
        return error(err);
      }
    })) as ToolCallback<InputArgs>;

  tools.set(name, server.registerTool(name, config, wrappedHandler));
};

/**
 * Create a tool registrar that curries the common `tools` Map and `server`
 * arguments. Eliminates repetitive boilerplate from every tool definition.
 *
 * This is the recommended API for plugin tool registration:
 *
 * @example
 * ```ts
 * export const registerTools = (server: McpServer): Map<string, RegisteredTool> => {
 *   const { tools, define } = createToolRegistrar(server);
 *
 *   define('slack_list_channels', {
 *     description: 'List Slack channels the user belongs to',
 *     inputSchema: {
 *       limit: z.number().optional().default(100),
 *     },
 *   }, async ({ limit }) => {
 *     const result = await sendServiceRequest('slack', {
 *       method: 'conversations.list',
 *       params: { limit, types: 'public_channel,private_channel' },
 *     });
 *     return success(result);
 *   });
 *
 *   return tools;
 * };
 * ```
 *
 * @param server - The MCP server to register tools on
 * @returns An object with the `tools` map and a curried `define` function
 */
const createToolRegistrar = (
  server: McpServer,
): {
  tools: Map<string, RegisteredTool>;
  define: <InputArgs extends ZodRawShapeCompat>(
    name: string,
    config: ToolConfig<InputArgs>,
    handler: ToolCallback<InputArgs>,
  ) => void;
} => {
  const tools = new Map<string, RegisteredTool>();

  const define = <InputArgs extends ZodRawShapeCompat>(
    name: string,
    config: ToolConfig<InputArgs>,
    handler: ToolCallback<InputArgs>,
  ): void => {
    defineTool(tools, server, name, config, handler);
  };

  return { tools, define };
};

export type { ToolResult, RequestProvider, ToolConfig, ErrorPattern };

export {
  isJsonRpcError,
  __setRequestProvider,
  __resetRequestProvider,
  __resetErrorPatterns,
  __registerPluginPermissions,
  __resetPluginPermissions,
  getCurrentToolId,
  withToolId,
  hasNativeApiPermission,
  sendServiceRequest,
  sendBrowserRequest,
  reloadExtension,
  success,
  error,
  formatError,
  registerErrorPatterns,
  defineTool,
  createToolRegistrar,
};
