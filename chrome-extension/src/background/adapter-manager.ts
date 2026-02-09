/**
 * Adapter Manager
 *
 * Registers and dispatches to MAIN world adapters. Each adapter is a small
 * self-contained script (e.g. adapters/slack.iife.js) that runs in the page's
 * JS context and exposes a `handleRequest(jsonRpcRequest)` method on
 * window.__openTabs.adapters[name].
 *
 * Two responsibilities:
 * 1. Registration — injects adapters as persistent MAIN world content scripts
 *    via chrome.scripting.registerContentScripts.
 * 2. Dispatch — forwards JSON-RPC requests to the adapter and returns the
 *    JSON-RPC response, bridging the MAIN ↔ background gap.
 *
 * To add a new service adapter:
 * 1. Create chrome-extension/src/adapters/<service>.ts with a handleRequest method
 * 2. Add an entry to ADAPTER_CONFIG below
 * 3. Add the built .iife.js to web_accessible_resources in manifest.ts
 */

import { SERVICE_REGISTRY } from '@extension/shared';
import type { JsonRpcRequest, JsonRpcResponse, ServiceType } from '@extension/shared';

/**
 * Adapter names match ServiceType — each service type has one MAIN world adapter.
 */
type AdapterName = ServiceType;

/**
 * Map of adapter names to their built script paths and URL match patterns.
 * Derived from SERVICE_REGISTRY — no manual enumeration needed.
 */
const ADAPTER_CONFIG: Record<string, { script: string; matches: string[] }> = Object.fromEntries(
  SERVICE_REGISTRY.map(def => {
    const allPatterns = Object.values(def.urlPatterns).flat();
    return [
      def.type,
      {
        script: `adapters/${def.type}.iife.js`,
        matches: [...allPatterns],
      },
    ];
  }),
);

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all adapters as persistent MAIN world content scripts.
 * Called once during extension initialization. Safe to call again after
 * extension reload — existing registrations are cleaned up first.
 */
const registerAdapters = async (): Promise<void> => {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ids = existing.filter(s => s.id.startsWith('adapter-')).map(s => s.id);
    if (ids.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids });
    }
  } catch {
    // No scripts registered yet — nothing to clean up
  }

  const registrations = Object.entries(ADAPTER_CONFIG).map(([name, config]) => ({
    id: `adapter-${name}`,
    js: [config.script],
    matches: config.matches,
    runAt: 'document_idle' as const,
    world: 'MAIN' as const,
    persistAcrossSessions: true,
  }));

  await chrome.scripting.registerContentScripts(registrations);
  console.log(
    '[OpenTabs] Registered adapters:',
    registrations.map(r => r.id),
  );
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Forward a JSON-RPC request to an adapter running in the MAIN world and
 * return its JSON-RPC response. This is the single dispatch function —
 * callers do not need to know what methods the adapter supports.
 */
const dispatchToAdapter = async (
  tabId: number,
  adapter: AdapterName,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (adapterName: string, jsonRpcRequest: JsonRpcRequest) => {
        const openTabs = (window as unknown as { __openTabs?: { adapters: Record<string, unknown> } }).__openTabs;
        if (!openTabs?.adapters) {
          return {
            jsonrpc: '2.0' as const,
            id: jsonRpcRequest.id,
            error: { code: -32603, message: 'OpenTabs adapters not loaded' },
          };
        }

        const instance = openTabs.adapters[adapterName] as
          | { handleRequest?: (req: JsonRpcRequest) => Promise<JsonRpcResponse> }
          | undefined;

        if (!instance?.handleRequest || typeof instance.handleRequest !== 'function') {
          return {
            jsonrpc: '2.0' as const,
            id: jsonRpcRequest.id,
            error: { code: -32603, message: `Adapter "${adapterName}" not loaded or missing handleRequest` },
          };
        }

        return instance.handleRequest(jsonRpcRequest);
      },
      args: [adapter, request],
    });

    if (chrome.runtime.lastError) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: chrome.runtime.lastError.message ?? 'Unknown chrome error' },
      };
    }

    const result = results[0]?.result as JsonRpcResponse | undefined;
    return result ?? { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'No result from adapter' } };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32603, message: normalizeError(err) },
    };
  }
};

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

const normalizeError = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('Cannot access')) {
    return 'Cannot access this page. The tab may be on a restricted URL.';
  }
  if (msg.includes('No tab with id')) {
    return 'Tab not found. It may have been closed.';
  }

  return msg;
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { AdapterName };
export { registerAdapters, dispatchToAdapter };
