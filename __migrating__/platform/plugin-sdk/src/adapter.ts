// =============================================================================
// @opentabs/plugin-sdk/adapter
//
// Utilities for MAIN world adapter scripts. Plugin authors import from this
// module when writing their adapter code (the script that runs in the web
// page's JavaScript context and accesses authenticated APIs).
//
// At build time, Vite inlines everything into a self-contained IIFE — there
// are no runtime imports in the final adapter bundle. This module re-exports
// the essential JSON-RPC helpers from @opentabs/core and adds the adapter
// registration function.
//
// Usage in a plugin adapter:
//
//   import { ok, fail, registerAdapter, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR } from '@opentabs/plugin-sdk/adapter';
//   import type { JsonRpcRequest, JsonRpcResponse } from '@opentabs/plugin-sdk/adapter';
//
//   const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
//     const { id, method, params } = request;
//     const [, action] = method.split('.');
//     // ... handle actions ...
//   };
//
//   registerAdapter('my-service', handleRequest);
//
// =============================================================================

import { JsonRpcErrorCode, createJsonRpcSuccess, createJsonRpcError } from '@opentabs/core';
import type { JsonRpcRequest, JsonRpcResponse } from '@opentabs/core';

// -----------------------------------------------------------------------------
// JSON-RPC Response Helpers
//
// Shorthand aliases that match the terse naming convention used by all
// existing adapters. These are the primary API for adapter authors.
// -----------------------------------------------------------------------------

/** Create a JSON-RPC success response. Alias for createJsonRpcSuccess. */
const ok = createJsonRpcSuccess;

/**
 * Create a JSON-RPC error response.
 *
 * @param id - The request ID to echo back
 * @param code - A JsonRpcErrorCode value (use the exported constants)
 * @param message - Human-readable error description
 */
const fail = (id: string, code: number, message: string): JsonRpcResponse => createJsonRpcError(id, code, message);

// -----------------------------------------------------------------------------
// Error Code Constants
//
// Re-exported from @opentabs/core for convenience. Plugin adapters should
// use these named constants rather than raw numbers.
// -----------------------------------------------------------------------------

/** -32602: Missing or invalid parameters in the JSON-RPC request. */
const INVALID_PARAMS = JsonRpcErrorCode.INVALID_PARAMS;

/** -32601: The requested method (action) does not exist on this adapter. */
const METHOD_NOT_FOUND = JsonRpcErrorCode.METHOD_NOT_FOUND;

/** -32603: An unexpected internal error occurred during request handling. */
const INTERNAL_ERROR = JsonRpcErrorCode.INTERNAL_ERROR;

/** -32001: The user's session is expired or not authenticated. */
const NOT_AUTHENTICATED = JsonRpcErrorCode.NOT_AUTHENTICATED;

// -----------------------------------------------------------------------------
// Window Type Extension
//
// The adapter registry lives on window.__openTabs.adapters. Each adapter
// registers itself by name, and the platform's adapter-manager dispatches
// JSON-RPC requests to the correct adapter by name.
// -----------------------------------------------------------------------------

/** Handler function signature that every adapter must implement. */
type AdapterRequestHandler = (request: JsonRpcRequest) => Promise<JsonRpcResponse>;

declare global {
  interface Window {
    __openTabs?: {
      adapters: Record<string, { handleRequest: AdapterRequestHandler } | undefined>;
    };
  }
}

// -----------------------------------------------------------------------------
// Adapter Registration
// -----------------------------------------------------------------------------

/**
 * Register a MAIN world adapter on the page's global scope.
 *
 * This is the entry point every adapter must call exactly once. The platform's
 * background script dispatches JSON-RPC requests to the adapter by looking up
 * `window.__openTabs.adapters[name].handleRequest`.
 *
 * @param name - The plugin name (must match the `name` field in opentabs-plugin.json)
 * @param handleRequest - The function that processes incoming JSON-RPC requests
 *
 * @example
 * ```ts
 * registerAdapter('jira', async (request) => {
 *   const { id, method, params } = request;
 *   const [, action] = method.split('.');
 *   switch (action) {
 *     case 'api':
 *       const data = await callJiraApi(params);
 *       return ok(id, data);
 *     default:
 *       return fail(id, METHOD_NOT_FOUND, `Unknown action: ${action}`);
 *   }
 * });
 * ```
 */
const registerAdapter = (name: string, handleRequest: AdapterRequestHandler): void => {
  // Ensure the global adapter registry exists
  window.__openTabs = window.__openTabs ?? { adapters: {} };

  // Register this adapter
  window.__openTabs.adapters[name] = { handleRequest };

  // Log registration for debugging (visible in the page's DevTools console)
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  console.log(`[OpenTabs] ${displayName} adapter loaded`);
};

// -----------------------------------------------------------------------------
// Adapter Utilities
//
// Common patterns used by adapters extracted into reusable helpers.
// -----------------------------------------------------------------------------

/**
 * Parse the action from a JSON-RPC method string.
 *
 * JSON-RPC methods in OpenTabs follow the convention `<service>.<action>`.
 * This helper extracts the action portion.
 *
 * @param method - The full JSON-RPC method string (e.g. 'slack.api')
 * @returns The action string (e.g. 'api'), or undefined if malformed
 */
const parseAction = (method: string): string | undefined => {
  const dotIndex = method.indexOf('.');
  if (dotIndex === -1 || dotIndex === method.length - 1) return undefined;
  return method.slice(dotIndex + 1);
};

/**
 * Create a scoped fetch function that restricts requests to allowed domains.
 *
 * The platform uses this to wrap the native fetch for plugin adapters,
 * enforcing the network permission boundaries declared in the plugin manifest.
 * Plugin authors can also use it directly for defense-in-depth.
 *
 * @param allowedDomains - Domain patterns the adapter is permitted to access.
 *   Supports leading wildcards: '*.example.com' matches 'api.example.com'.
 *   Exact matches: 'api.example.com' matches only that hostname.
 * @param pluginName - The plugin name, used in error messages.
 * @returns A fetch-compatible function that rejects disallowed domains.
 */
const createScopedFetch = (allowedDomains: readonly string[], pluginName: string): typeof fetch => {
  const originalFetch = globalThis.fetch;

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      globalThis.location?.origin,
    );

    const isAllowed = allowedDomains.some(domain => {
      if (domain.startsWith('*.')) {
        // Wildcard domain: '*.example.com' matches 'sub.example.com'
        const suffix = domain.slice(1); // '.example.com'
        return url.hostname.endsWith(suffix) || url.hostname === domain.slice(2);
      }
      // Exact match or suffix match for dot-prefixed domains
      if (domain.startsWith('.')) {
        return url.hostname.endsWith(domain) || url.hostname === domain.slice(1);
      }
      return url.hostname === domain;
    });

    // Always allow same-origin requests (the page the adapter is running on)
    const isSameOrigin = globalThis.location && url.origin === globalThis.location.origin;

    if (!isAllowed && !isSameOrigin) {
      return Promise.reject(
        new Error(
          `Plugin "${pluginName}" is not allowed to access ${url.hostname}. ` +
            `Allowed domains: ${allowedDomains.join(', ')}`,
        ),
      );
    }

    return originalFetch(input, init);
  };
};

export type { JsonRpcRequest, JsonRpcResponse, AdapterRequestHandler };

export {
  ok,
  fail,
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  INTERNAL_ERROR,
  NOT_AUTHENTICATED,
  registerAdapter,
  parseAction,
  createScopedFetch,
};
