// Utility functions for MCP server

import { relay } from './websocket-relay.js';
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

/**
 * Format error message for user display
 */
const formatError = (err: unknown): string => {
  if (err instanceof Error) {
    const message = err.message;

    // Provide user-friendly messages for common errors
    if (message.includes('not connected')) {
      return 'Chrome extension not connected. Please ensure:\n1. The OpenTabs extension is installed in Chrome\n2. You have a Slack or Datadog tab open\n3. You are logged in\n4. Click the extension icon to verify connection status';
    }

    if (message.includes('timed out')) {
      return 'Request timed out. The API may be slow or the extension disconnected. Try refreshing the tab.';
    }

    if (message.includes('channel_not_found') || message.includes('Channel not found')) {
      return 'Channel not found. Please check the channel name or ID is correct. For private channels, use the channel ID (starts with C).';
    }

    if (message.includes('not_in_channel')) {
      return 'You are not a member of this channel. Join the channel first in Slack.';
    }

    if (message.includes('invalid_auth') || message.includes('not_authed')) {
      return 'Authentication failed. Please refresh your Slack tab and try again. If the issue persists, sign out and back into Slack.';
    }

    if (message.includes('ratelimited')) {
      return 'Rate limited by the API. Please wait a moment and try again.';
    }

    if (message.includes('missing_scope')) {
      return 'Missing permissions. Your session may not have access to this feature.';
    }

    if (message.includes('user_not_found')) {
      return 'User not found. Please check the user ID is correct (should start with U).';
    }

    if (message.includes('Connection closed')) {
      return 'Connection to extension was lost. Please check that the tab is still open and refresh it if needed.';
    }

    // Datadog-specific errors
    if (message.includes('No Datadog authentication')) {
      return 'Not connected to Datadog. Please open Datadog in Chrome and ensure you are logged in.';
    }

    if (message.includes('Datadog tab not found')) {
      return 'Datadog tab not found. Please open Datadog in a browser tab and try again.';
    }

    // Permission errors - provide helpful context
    if (message.includes('401') || message.includes('Unauthorized')) {
      return 'Unauthorized: This API requires elevated permissions not available via browser session. This is expected for some admin-level APIs like audit logs.';
    }

    if (message.includes('403') || message.includes('Forbidden')) {
      return 'Forbidden: Your user account does not have permission to access this resource. This typically requires admin or elevated permissions.';
    }

    // SQLPad-specific errors
    if (message.includes('No SQLPad authentication')) {
      return 'Not connected to SQLPad. Please open SQLPad in Chrome and ensure you are logged in.';
    }

    if (message.includes('SQLPad tab not found')) {
      return 'SQLPad tab not found. Please open SQLPad in a browser tab and try again.';
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

export { formatError };
export type { ToolResult, ServiceEnv };
