/**
 * Bridge for side panel ↔ background script ↔ MCP server communication.
 *
 * Uses chrome.runtime.sendMessage with bg:* message types to relay JSON-RPC
 * requests to the MCP server. Responses return asynchronously via sp:serverMessage
 * and are correlated by request ID using a pending-request map.
 *
 * Each pending request has a 30-second timeout to prevent hanging promises when
 * the server disconnects between send and response. All pending requests are
 * also rejected on WebSocket disconnect (sp:connectionState connected=false).
 */

import type { DisconnectReason } from '../extension-messages.js';
import type { ConfigStateFailedPlugin, ConfigStatePlugin, ConfigStateResult } from '@opentabs-dev/shared';

/** Plugin state as displayed in the side panel (matches config.getState response) */
type PluginState = ConfigStatePlugin;

/** Failed plugin state as displayed in the side panel */
type FailedPluginState = ConfigStateFailedPlugin;

/** Returns true if a tool's displayName, name, or description matches the filter string */
const matchesTool = (tool: PluginState['tools'][number], filterLower: string): boolean =>
  tool.displayName.toLowerCase().includes(filterLower) ||
  tool.name.toLowerCase().includes(filterLower) ||
  tool.description.toLowerCase().includes(filterLower);

/** Timeout for pending JSON-RPC requests relayed through the background script (ms) */
const REQUEST_TIMEOUT_MS = 30_000;

/** Pending JSON-RPC request awaiting a server response */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timerId: ReturnType<typeof setTimeout>;
}

/** Map of request ID → pending request. Responses are matched by ID. */
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Reject all pending requests immediately.
 * Called on WebSocket disconnect (sp:connectionState connected=false) so the
 * side panel gets fast errors instead of waiting for individual 30s timeouts.
 */
const rejectAllPending = (): void => {
  for (const [id, pending] of pendingRequests) {
    pendingRequests.delete(id);
    clearTimeout(pending.timerId);
    pending.reject(new Error('Server disconnected'));
  }
};

/**
 * Send a JSON-RPC request to the MCP server via the background script.
 * Returns a promise that resolves with the MCP server's response (not the
 * background script's ack). Call handleServerResponse() when sp:serverMessage
 * arrives to resolve pending requests.
 */
const sendRequest = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
  const id = crypto.randomUUID();
  const data = { jsonrpc: '2.0', method, params, id };

  return new Promise<unknown>((resolve, reject) => {
    const timerId = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timerId });

    chrome.runtime.sendMessage({ type: 'bg:send', data }).catch((err: unknown) => {
      clearTimeout(timerId);
      pendingRequests.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
};

/**
 * Handle a server message forwarded by the background script.
 * If the message is a response (has id, no method), resolve the matching
 * pending request and return true. Otherwise return false so the caller
 * can handle it as a notification.
 */
const handleServerResponse = (data: Record<string, unknown>): boolean => {
  const rawId = data.id as string | number | null | undefined;
  if (rawId === undefined || rawId === null || data.method) return false;
  const id = String(rawId);

  const pending = pendingRequests.get(id);
  if (!pending) return false;

  pendingRequests.delete(id);
  clearTimeout(pending.timerId);

  if ('error' in data) {
    const err = data.error as { message?: string };
    pending.reject(new Error(err.message ?? 'Unknown server error'));
  } else {
    pending.resolve(data.result);
  }

  return true;
};

/** Result from querying the background script for WebSocket connection state */
interface ConnectionStateResult {
  connected: boolean;
  disconnectReason?: DisconnectReason;
}

/** Query the background script for WebSocket connection state */
const getConnectionState = (): Promise<ConnectionStateResult> =>
  new Promise(resolve => {
    chrome.runtime.sendMessage(
      { type: 'bg:getConnectionState' },
      (response: { connected?: boolean; disconnectReason?: DisconnectReason } | undefined) => {
        if (chrome.runtime.lastError) {
          resolve({ connected: false });
        } else {
          resolve({
            connected: response?.connected === true,
            disconnectReason: response?.disconnectReason,
          });
        }
      },
    );
  });

/** Request full state from MCP server via config.getState */
const fetchConfigState = () => sendRequest('config.getState') as Promise<ConfigStateResult>;

/** Toggle a single tool's enabled state */
const setToolEnabled = (plugin: string, tool: string, enabled: boolean): Promise<unknown> =>
  sendRequest('config.setToolEnabled', { plugin, tool, enabled });

/** Toggle all tools for a plugin */
const setAllToolsEnabled = (plugin: string, enabled: boolean): Promise<unknown> =>
  sendRequest('config.setAllToolsEnabled', { plugin, enabled });

/** Send a confirmation response to the MCP server via the background script (fire-and-forget) */
const sendConfirmationResponse = (
  id: string,
  decision: 'allow_once' | 'allow_always' | 'deny',
  scope?: 'tool_domain' | 'tool_all' | 'domain_all',
): void => {
  chrome.runtime
    .sendMessage({
      type: 'sp:confirmationResponse' as const,
      data: { id, decision, ...(scope ? { scope } : {}) },
    })
    .catch((err: unknown) => {
      console.warn('[opentabs:side-panel] Failed to send confirmation response:', err);
    });
};

export type { FailedPluginState, PluginState };
export {
  getConnectionState,
  fetchConfigState,
  matchesTool,
  setToolEnabled,
  setAllToolsEnabled,
  handleServerResponse,
  rejectAllPending,
  sendConfirmationResponse,
};
