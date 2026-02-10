import type { JsonRpcId, JsonRpcSuccessResponse, JsonRpcErrorResponse, JsonRpcRequest } from '@opentabs/core';

// ---------------------------------------------------------------------------
// Error Code Constants
// ---------------------------------------------------------------------------

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const SERVICE_ERROR = -32000;
const AUTH_ERROR = -32001;

// ---------------------------------------------------------------------------
// JSON-RPC Response Helpers
// ---------------------------------------------------------------------------

/** Construct a JSON-RPC success response */
const ok = (id: JsonRpcId, data: unknown): JsonRpcSuccessResponse => ({
  jsonrpc: '2.0',
  id,
  result: data,
});

/** Construct a JSON-RPC error response */
const fail = (id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

// ---------------------------------------------------------------------------
// parseAction — extract the action from a JSON-RPC method string
// ---------------------------------------------------------------------------

/**
 * Extract the action portion from a method string.
 * Method strings follow the pattern `service.action` — this returns the action.
 * If there is no dot separator, returns the full method string.
 */
const parseAction = (method: string): string => {
  const dotIndex = method.indexOf('.');
  return dotIndex === -1 ? method : method.slice(dotIndex + 1);
};

// ---------------------------------------------------------------------------
// createScopedFetch — domain-restricted fetch wrapper
// ---------------------------------------------------------------------------

/** Fetch function signature compatible with both browser and Node.js environments */
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Create a fetch wrapper that restricts requests to a set of allowed domains.
 * Useful for ensuring adapter code only communicates with the expected service.
 */
const createScopedFetch = (allowedDomains: readonly string[], pluginName: string): FetchFn => {
  const domainSet = new Set(allowedDomains);

  const scopedFetch: FetchFn = (input, init?) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!domainSet.has(url.hostname)) {
      return Promise.reject(
        new Error(
          `[${pluginName}] Fetch blocked: "${url.hostname}" is not in allowed domains [${allowedDomains.join(', ')}]`,
        ),
      );
    }
    return globalThis.fetch(input, init);
  };

  return scopedFetch;
};

// ---------------------------------------------------------------------------
// AdapterRequestHandler type
// ---------------------------------------------------------------------------

/** Handler function signature for adapter request processing */
type AdapterRequestHandler = (request: JsonRpcRequest) => Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse>;

// ---------------------------------------------------------------------------
// registerAdapter — register a MAIN world adapter on globalThis.__openTabs
// ---------------------------------------------------------------------------

/** Global namespace for OpenTabs adapters */
interface OpenTabsGlobal {
  adapters: Map<string, AdapterRequestHandler>;
}

/**
 * Augment globalThis with the __openTabs namespace.
 * Adapters run in the page's MAIN world where this is on the window object,
 * but we use globalThis for TypeScript compatibility without requiring DOM lib.
 */

declare global {
  var __openTabs: OpenTabsGlobal | undefined;
}

/**
 * Register a MAIN world adapter for a plugin service.
 * The adapter is stored on `globalThis.__openTabs.adapters` keyed by name.
 * The extension dispatches incoming JSON-RPC requests to the matching adapter.
 */
const registerAdapter = (name: string, handleRequest: AdapterRequestHandler): void => {
  if (globalThis.__openTabs === undefined) {
    globalThis.__openTabs = { adapters: new Map() };
  }

  globalThis.__openTabs.adapters.set(name, handleRequest);
};

// ---------------------------------------------------------------------------
// Exports (all at bottom per ESLint exports-last rule)
// ---------------------------------------------------------------------------

export {
  registerAdapter,
  ok,
  fail,
  parseAction,
  createScopedFetch,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
  SERVICE_ERROR,
  AUTH_ERROR,
  type AdapterRequestHandler,
  type OpenTabsGlobal,
  type FetchFn,
};
