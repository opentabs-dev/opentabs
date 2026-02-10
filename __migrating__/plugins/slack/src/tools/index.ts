// =============================================================================
// Slack Plugin — Tools Entry Point
//
// This is the module referenced by opentabs-plugin.json's "tools.entry" field.
// It must export a named `registerTools` function matching the standard
// ToolRegistrationFn signature.
//
// Optionally exports `isHealthy` — a custom health check evaluator that the
// platform's plugin-loader wires into the service controller. Slack needs this
// because the Slack Web API wraps its own errors inside successful JSON-RPC
// responses (the response is technically not a JSON-RPC error, but the
// response.result.ok field is false).
// =============================================================================

import { registerMessageTools } from './messages.js';
import { registerSearchTools } from './search.js';
import { isJsonRpcError } from '@opentabs/core';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JsonRpcResponse, HealthCheckEvaluator } from '@opentabs/core';

// ---------------------------------------------------------------------------
// Tool Registration Function Type
// ---------------------------------------------------------------------------

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

// ---------------------------------------------------------------------------
// All Tool Registrations
//
// Each tool module exports a registration function. Adding a new tool file
// requires only importing it here and adding it to this array.
// ---------------------------------------------------------------------------

const TOOL_REGISTRATIONS: ToolRegistrationFn[] = [
  registerMessageTools,
  registerSearchTools,
  // Future tool modules:
  // registerChannelTools,
  // registerConversationTools,
  // registerUserTools,
  // registerFileTools,
  // registerPinTools,
  // registerStarTools,
  // registerReactionTools,
];

// ---------------------------------------------------------------------------
// registerTools — Required Export
//
// The platform's plugin-loader dynamically imports this module and calls
// registerTools(server) to register all Slack tools on an MCP server instance.
// The returned Map is used by the hot-reload system to update tool handlers
// on existing sessions without disconnecting clients.
// ---------------------------------------------------------------------------

/**
 * Register all Slack MCP tools on the given server.
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
// Custom health check evaluator for Slack. The platform detects this export
// during plugin loading and wires it into the WebappServiceController's
// health check pipeline.
//
// Slack's Web API has a unique behavior: API errors are returned as
// successful HTTP responses (and therefore successful JSON-RPC responses)
// with { ok: false, error: "..." } in the result body. The default health
// check evaluator (which just checks !isJsonRpcError) would incorrectly
// treat an expired session as healthy. This evaluator checks the inner
// ok field to catch authentication failures.
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a Slack health check response indicates a healthy session.
 *
 * The health check calls `auth.test` via the adapter. A healthy response has:
 * - No JSON-RPC error
 * - result.ok === true
 *
 * An unhealthy response has result.ok === false with an error string like
 * "invalid_auth", "not_authed", or "token_revoked".
 *
 * @param response - The JSON-RPC response from the health check request
 * @param authErrorPatterns - Strings that indicate authentication failure
 * @returns true if the session is healthy, false otherwise
 */
export const isHealthy: HealthCheckEvaluator = (
  response: JsonRpcResponse,
  authErrorPatterns: readonly string[],
): boolean => {
  // JSON-RPC level error — adapter itself failed (tab closed, etc.)
  if (isJsonRpcError(response)) return false;

  // Slack API level error — successful JSON-RPC but Slack returned an error
  const data = response.result as { ok?: boolean; error?: string } | undefined;

  if (data && data.ok === false) {
    const error = data.error ?? '';

    // Check if this is specifically an auth error (for logging purposes)
    if (authErrorPatterns.some(pattern => error.includes(pattern))) {
      console.log(`[OpenTabs] Slack session expired: ${error}`);
    }

    return false;
  }

  return true;
};
