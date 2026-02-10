/**
 * Slack Health Check Evaluator
 *
 * Lightweight module that exports the isHealthy function for use by the
 * browser extension background script. This module only depends on
 * @opentabs/core (no MCP server dependencies), so it can be bundled into
 * the extension without pulling in @modelcontextprotocol/sdk or zod.
 *
 * The tools entry point (tools/index.ts) re-exports this for the MCP server
 * path, where it's loaded via the plugin-loader.
 */

import { isJsonRpcError } from '@opentabs/core';
import type { JsonRpcResponse } from '@opentabs/core';

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
 * Slack's Web API has a unique behavior: API errors are returned as
 * successful HTTP responses (and therefore successful JSON-RPC responses)
 * with { ok: false, error: "..." } in the result body. The default health
 * check evaluator (which just checks !isJsonRpcError) would incorrectly
 * treat an expired session as healthy. This evaluator checks the inner
 * ok field to catch authentication failures.
 *
 * @param response - The JSON-RPC response from the health check request
 * @param authErrorPatterns - Strings that indicate authentication failure
 * @returns true if the session is healthy, false otherwise
 */
export const isHealthy = (response: JsonRpcResponse, authErrorPatterns: readonly string[]): boolean => {
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
