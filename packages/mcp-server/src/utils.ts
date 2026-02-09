// Utility functions for MCP server

import { relay } from './websocket-relay.js';
import { SERVICE_REGISTRY } from '@extension/shared';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServiceEnv, ServiceType } from '@extension/shared';
import type { McpServer, RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

// Store the current tool ID in async local storage so it's available in nested calls
const toolIdStorage = new AsyncLocalStorage<string>();

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// =================
// Error Formatting
// =================

/** Build a display-name lookup from the registry for error messages */
const SERVICE_NAME_LOOKUP: Record<string, string> = Object.fromEntries(
  SERVICE_REGISTRY.map(def => [def.type, def.displayName]),
);

/** Common error patterns and their user-friendly messages */
const ERROR_PATTERNS: Array<{ match: (msg: string) => boolean; format: (msg: string) => string }> = [
  {
    match: msg => msg.includes('not connected'),
    format: () =>
      'Chrome extension not connected. Please ensure:\n1. The OpenTabs extension is installed in Chrome\n2. You have a service tab open\n3. You are logged in\n4. Click the extension icon to verify connection status',
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
    format: () => 'You are not a member of this channel. Join the channel first in Slack.',
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
    format: () => 'User not found. Please check the user ID is correct (should start with U).',
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
 * Detect which service a message refers to and generate "not connected" / "tab not found" messages.
 * Uses display names from the registry instead of hardcoded service-specific if-chains.
 */
const detectServiceError = (msg: string): string | null => {
  for (const name of Object.values(SERVICE_NAME_LOOKUP)) {
    if (msg.includes(`No ${name} authentication`) || msg.includes(`No ${name} tab`)) {
      return `Not connected to ${name}. Please open ${name} in Chrome and ensure you are logged in.`;
    }
    if (msg.includes(`${name} tab not found`)) {
      return `${name} tab not found. Please open ${name} in a browser tab and try again.`;
    }
  }
  return null;
};

/**
 * Format error message for user display.
 * Uses pattern matching instead of service-specific hardcoding.
 */
const formatError = (err: unknown): string => {
  if (err instanceof Error) {
    const message = err.message;

    // Check service-specific errors (derived from registry)
    const serviceErr = detectServiceError(message);
    if (serviceErr) return serviceErr;

    // Check common error patterns
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.match(message)) return pattern.format(message);
    }

    return message;
  }

  return String(err);
};

/**
 * Get the current tool ID from async local storage
 */
export const getCurrentToolId = (): string | undefined => toolIdStorage.getStore();

/**
 * Run a function with a tool ID context
 */
export const withToolId = <T>(toolId: string, fn: () => T): T => toolIdStorage.run(toolId, fn);

// =================
// Generic Service Request Functions
// =================

/**
 * Send a request to any webapp service adapter.
 * Automatically injects the current tool ID for permission checking.
 * @param action - The adapter action to invoke (default: "api")
 */
export const sendServiceRequest = (
  service: ServiceType,
  params: Record<string, unknown>,
  action?: string,
): Promise<unknown> => {
  const toolId = getCurrentToolId();
  return relay.sendServiceRequest(service, { ...params, toolId }, action);
};

/**
 * Send a request to Slack's Enterprise Edge API.
 * Used for enterprise-specific endpoints like users/search, channels/list, users/list.
 */
export const sendSlackEdgeRequest = (endpoint: string, params: Record<string, unknown>): Promise<unknown> => {
  const toolId = getCurrentToolId();
  return relay.sendSlackEdgeRequest(endpoint, params, toolId);
};

// =================
// Native Service Functions (Browser, System)
// =================

/**
 * Send a request to the browser controller (chrome.tabs/windows APIs)
 */
export const sendBrowserRequest = <T>(action: string, params?: Record<string, unknown>): Promise<T> => {
  const toolId = getCurrentToolId();
  return relay.sendBrowserRequest<T>(action, { ...params, toolId });
};

/**
 * Reload the Chrome extension
 */
export const reloadExtension = (): Promise<{ reloading: boolean }> => relay.reloadExtension();

// =================
// Tool Result Formatting
// =================

/**
 * Format a successful tool result
 */
export const success = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

/**
 * Format an error tool result with user-friendly message
 */
export const error = (err: unknown): ToolResult => {
  const message = formatError(err);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
};

// =================
// Tool Registration Helper
// =================

/**
 * Register a tool on the MCP server with automatic withToolId wrapping and
 * error handling. Eliminates the triple name repetition and try/catch
 * boilerplate from every tool definition.
 *
 * The handler runs inside withToolId(name, ...) and is wrapped in a
 * try/catch that returns error(err) on failure. Handlers should call
 * success() explicitly for their return values.
 */
export const defineTool = <InputArgs extends ZodRawShapeCompat>(
  tools: Map<string, RegisteredTool>,
  server: McpServer,
  name: string,
  config: { title?: string; description?: string; inputSchema?: InputArgs; annotations?: ToolAnnotations },
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

// =================
// Tool Registrar Factory
// =================

/**
 * Create a tool registrar that curries the common `tools` Map and `server`
 * arguments. Eliminates the repetitive `(tools, server, ...)` from every
 * `defineTool` call and the boilerplate Map creation in every registration
 * function.
 *
 * Usage:
 * ```
 * export const registerChannelTools = (server: McpServer) => {
 *   const { tools, define } = createToolRegistrar(server);
 *   define('slack_list_channels', { description: '...' }, async () => { ... });
 *   return tools;
 * };
 * ```
 */
export const createToolRegistrar = (server: McpServer) => {
  const tools = new Map<string, RegisteredTool>();

  const define = <InputArgs extends ZodRawShapeCompat>(
    name: string,
    config: { title?: string; description?: string; inputSchema?: InputArgs; annotations?: ToolAnnotations },
    handler: ToolCallback<InputArgs>,
  ): void => {
    defineTool(tools, server, name, config, handler);
  };

  return { tools, define };
};

export { formatError };
export type { ToolResult, ServiceEnv };
