// =============================================================================
// {{displayName}} Plugin — Tools Entry Point
//
// This module is referenced by opentabs-plugin.json's "tools.entry" field.
// It must export a named `registerTools` function matching the standard
// ToolRegistrationFn signature.
//
// Optionally exports `isHealthy` — a custom health check evaluator that the
// platform's plugin-loader wires into the service controller. If the target
// web application returns errors inside successful JSON-RPC responses (like
// Slack's { ok: false, error: "..." } pattern), implement isHealthy to detect
// those cases. Otherwise, the default evaluator (!isJsonRpcError) is sufficient.
// =============================================================================

import { registerGeneralTools } from './general.js';
import { isJsonRpcError, registerErrorPatterns } from '@opentabs/plugin-sdk/server';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JsonRpcResponse, HealthCheckEvaluator } from '@opentabs/plugin-sdk';

// ---------------------------------------------------------------------------
// Tool Registration Function Type
// ---------------------------------------------------------------------------

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

// ---------------------------------------------------------------------------
// Error Patterns
//
// Register domain-specific error patterns for user-friendly error messages.
// These are checked after platform-level patterns (connection errors, timeouts,
// HTTP status codes). First match wins.
//
// Add patterns for common errors the target web application returns.
// ---------------------------------------------------------------------------

const ERROR_PATTERNS = [
  // Example patterns — customize for your target application:
  //
  // {
  //   match: (msg: string) => msg.includes('resource_not_found'),
  //   format: () => 'Resource not found. Check the ID and try again.',
  // },
  // {
  //   match: (msg: string) => msg.includes('rate_limited'),
  //   format: () => 'Rate limited. Please wait a moment and try again.',
  // },
  // {
  //   match: (msg: string) => msg.includes('insufficient_permissions'),
  //   format: () => 'Insufficient permissions for this operation.',
  // },
];

registerErrorPatterns(ERROR_PATTERNS);

// ---------------------------------------------------------------------------
// All Tool Registrations
//
// Each tool module exports a registration function. Adding a new tool file
// requires only importing it here and adding it to this array.
// ---------------------------------------------------------------------------

const TOOL_REGISTRATIONS: ToolRegistrationFn[] = [
  registerGeneralTools,
  // Add more tool modules here as you build them:
  // registerSearchTools,
  // registerAdminTools,
];

// ---------------------------------------------------------------------------
// registerTools — Required Export
//
// The platform's plugin-loader dynamically imports this module and calls
// registerTools(server) to register all tools on an MCP server instance.
// The returned Map is used by the hot-reload system to update tool handlers
// on existing sessions without disconnecting clients.
// ---------------------------------------------------------------------------

/**
 * Register all {{displayName}} MCP tools on the given server.
 *
 * @param server - The MCP server instance to register tools on
 * @returns A Map of tool name → RegisteredTool for hot-reload tracking
 */
export const registerTools = (server: McpServer): Map<string, RegisteredTool> => {
  const allTools = new Map<string, RegisteredTool>();

  for (const register of TOOL_REGISTRATIONS) {
    for (const [name, tool] of register(server)) {
      allTools.set(name, tool);
    }
  }

  return allTools;
};

// ---------------------------------------------------------------------------
// isHealthy — Optional Export
//
// Custom health check evaluator. Implement this if the target web application
// wraps its own errors inside successful HTTP/JSON-RPC responses.
//
// If the default evaluator (response is healthy when it's not a JSON-RPC
// error) works for your service, you can delete this export entirely.
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a health check response indicates a healthy session.
 *
 * @param response - The JSON-RPC response from the health check request
 * @param authErrorPatterns - Strings from the manifest that indicate auth failure
 * @returns true if the session is healthy, false otherwise
 */
export const isHealthy: HealthCheckEvaluator = (
  response: JsonRpcResponse,
  _authErrorPatterns: readonly string[],
): boolean => {
  // JSON-RPC level error — adapter itself failed (tab closed, etc.)
  if (isJsonRpcError(response)) return false;

  // Default: if there's no JSON-RPC error, the session is healthy.
  // Customize this for services that wrap errors in success responses.
  //
  // Example for APIs that return { ok: false, error: "..." }:
  //
  // const data = response.result as { ok?: boolean; error?: string } | undefined;
  // if (data && data.ok === false) {
  //   const error = data.error ?? '';
  //   if (_authErrorPatterns.some(pattern => error.includes(pattern))) {
  //     console.log(`[OpenTabs] {{displayName}} session expired: ${error}`);
  //   }
  //   return false;
  // }

  return true;
};
