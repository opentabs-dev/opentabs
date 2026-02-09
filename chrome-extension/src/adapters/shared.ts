/**
 * Shared adapter utilities — re-exports from @extension/shared plus adapter-specific helpers.
 *
 * Each adapter imports from this module. Vite inlines everything at build time
 * into self-contained IIFEs, so the final output has no runtime imports.
 */

import { JsonRpcErrorCode, createJsonRpcSuccess, createJsonRpcError } from '@extension/shared';
import type { JsonRpcRequest, JsonRpcResponse } from '@extension/shared';

// Re-export types and helpers from @extension/shared
const ok = createJsonRpcSuccess;
const fail = (id: string, code: number, message: string) => createJsonRpcError(id, code, message);

const INVALID_PARAMS = JsonRpcErrorCode.INVALID_PARAMS;
const METHOD_NOT_FOUND = JsonRpcErrorCode.METHOD_NOT_FOUND;
const INTERNAL_ERROR = JsonRpcErrorCode.INTERNAL_ERROR;

// ---------------------------------------------------------------------------
// Window type extension for the adapter registry
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __openTabs?: {
      adapters: Record<string, { handleRequest: (req: JsonRpcRequest) => Promise<JsonRpcResponse> } | undefined>;
    };
  }
}

// ---------------------------------------------------------------------------
// Adapter registration
// ---------------------------------------------------------------------------

const registerAdapter = (name: string, handleRequest: (req: JsonRpcRequest) => Promise<JsonRpcResponse>): void => {
  window.__openTabs = window.__openTabs || { adapters: {} };
  window.__openTabs.adapters[name] = { handleRequest };
  console.log(`[OpenTabs] ${name.charAt(0).toUpperCase() + name.slice(1)} adapter loaded`);
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { ok, fail, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR, registerAdapter };

export type { JsonRpcRequest, JsonRpcResponse };
