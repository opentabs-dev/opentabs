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

import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpServer, RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

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

  /**
   * Send a request to Slack's Enterprise Edge API. Slack-specific — provided
   * for backward compatibility with the existing Slack plugin.
   */
  sendSlackEdgeRequest?: (endpoint: string, params: Record<string, unknown>, toolId?: string) => Promise<unknown>;
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
 * // Call with a custom action
 * const data = await sendServiceRequest('slack', {
 *   method: 'auth.test',
 *   params: {},
 * }, 'api');
 * ```
 */
const sendServiceRequest = (service: string, params: Record<string, unknown>, action?: string): Promise<unknown> => {
  const toolId = getCurrentToolId();
  return getProvider().sendServiceRequest(service, { ...params, toolId }, action);
};

/**
 * Send a request to Slack's Enterprise Edge API.
 *
 * This is a Slack-specific convenience function for the Enterprise Edge API
 * (edgeapi.slack.com). Regular plugins should use sendServiceRequest() with
 * a custom action instead.
 *
 * @param endpoint - The Edge API endpoint (e.g. 'users/search')
 * @param params - Request parameters
 */
const sendSlackEdgeRequest = (endpoint: string, params: Record<string, unknown>): Promise<unknown> => {
  const p = getProvider();
  if (!p.sendSlackEdgeRequest) {
    throw new Error(
      'sendSlackEdgeRequest is not available. ' +
        'Ensure the MCP server request provider implements sendSlackEdgeRequest.',
    );
  }
  const toolId = getCurrentToolId();
  return p.sendSlackEdgeRequest(endpoint, params, toolId);
};

/**
 * Send a request to the browser controller (chrome.tabs/windows APIs).
 *
 * Requires the plugin to declare `nativeApis: ['browser']` in its manifest.
 * Without this permission, the request will be rejected by the platform.
 *
 * @param action - The browser controller action (e.g. 'listTabs', 'openTab')
 * @param params - Action-specific parameters
 */
const sendBrowserRequest = <T>(action: string, params?: Record<string, unknown>): Promise<T> => {
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
// Error Formatting
//
// Pattern-based error message formatting. Transforms raw error messages into
// actionable, user-friendly descriptions. Service-agnostic patterns are
// defined here; plugin-specific patterns could be added via a registry.
// =============================================================================

/** Error patterns and their user-friendly replacements. */
const ERROR_PATTERNS: Array<{
  match: (msg: string) => boolean;
  format: (msg: string) => string;
}> = [
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
    match: msg => msg.includes('channel_not_found') || msg.includes('Channel not found'),
    format: () =>
      'Channel not found. Please check the channel name or ID is correct. For private channels, use the channel ID (starts with C).',
  },
  {
    match: msg => msg.includes('not_in_channel'),
    format: () => 'You are not a member of this channel. Join the channel first.',
  },
  {
    match: msg => msg.includes('invalid_auth') || msg.includes('not_authed'),
    format: () =>
      'Authentication failed. Please refresh your service tab and try again. If the issue persists, sign out and back in.',
  },
  {
    match: msg => msg.includes('ratelimited'),
    format: () => 'Rate limited by the API. Please wait a moment and try again.',
  },
  {
    match: msg => msg.includes('missing_scope'),
    format: () => 'Missing permissions. Your session may not have access to this feature.',
  },
  {
    match: msg => msg.includes('user_not_found'),
    format: () => 'User not found. Please check the user ID is correct.',
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

/**
 * Format an error into a user-friendly message.
 *
 * Applies pattern matching against common error strings. If no pattern
 * matches, returns the raw error message.
 *
 * @param err - The error to format
 * @returns A user-friendly error description
 */
const formatError = (err: unknown): string => {
  if (err instanceof Error) {
    const message = err.message;

    for (const pattern of ERROR_PATTERNS) {
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

export type { ToolResult, RequestProvider, ToolConfig };

export {
  __setRequestProvider,
  __resetRequestProvider,
  getCurrentToolId,
  withToolId,
  sendServiceRequest,
  sendSlackEdgeRequest,
  sendBrowserRequest,
  reloadExtension,
  success,
  error,
  formatError,
  defineTool,
  createToolRegistrar,
};
