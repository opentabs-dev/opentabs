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
import type {
  ConfigStateBrowserTool,
  ConfigStateFailedPlugin,
  ConfigStatePlugin,
  ConfigStateResult,
  WireToolDef,
} from '@opentabs-dev/shared';

/** Plugin state as displayed in the side panel. tools is optional to reflect that the server response may omit it. */
type PluginState = Omit<ConfigStatePlugin, 'tools'> & { tools?: WireToolDef[] };

/** Failed plugin state as displayed in the side panel */
type FailedPluginState = ConfigStateFailedPlugin;

/** Browser tool state as displayed in the side panel (matches config.getState response) */
type BrowserToolState = ConfigStateBrowserTool;

/** npm registry search result for a plugin package */
interface PluginSearchResult {
  name: string;
  description: string;
  version: string;
  author: string;
  isOfficial: boolean;
}

/** Result returned after a successful plugin install or update */
interface PluginInstallResult {
  ok: true;
  plugin: {
    name: string;
    displayName: string;
    version: string;
    toolCount: number;
  };
}

/** Returns true if a tool's displayName, name, or description matches the filter string */
const matchesTool = (tool: WireToolDef, filterLower: string): boolean =>
  tool.displayName.toLowerCase().includes(filterLower) ||
  tool.name.toLowerCase().includes(filterLower) ||
  tool.description.toLowerCase().includes(filterLower);

/** Returns true if a plugin's displayName, name, or any tool name matches the filter string.
 * Tool descriptions are excluded to avoid false positives (e.g., "slack" matching unrelated
 * plugins that mention Slack in a tool description). */
const matchesPlugin = (plugin: PluginState, filterLower: string): boolean =>
  plugin.displayName.toLowerCase().includes(filterLower) ||
  plugin.name.toLowerCase().includes(filterLower) ||
  (plugin.tools ?? []).some(
    tool => tool.displayName.toLowerCase().includes(filterLower) || tool.name.toLowerCase().includes(filterLower),
  );

/**
 * Extracts a normalized short name from an npm package name for deduplication.
 * "@opentabs-dev/opentabs-plugin-slack" → "slack"
 * "opentabs-plugin-datadog" → "datadog"
 * "slack" → "slack"
 */
const extractShortName = (name: string): string => (name.split('/').pop() ?? name).replace(/^opentabs-plugin-/, '');

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
const fetchConfigState = () => sendRequest('config.getState') as Promise<Partial<ConfigStateResult>>;

/** Toggle a single tool's enabled state */
const setToolEnabled = (plugin: string, tool: string, enabled: boolean): Promise<unknown> =>
  sendRequest('config.setToolEnabled', { plugin, tool, enabled });

/** Toggle all tools for a plugin */
const setAllToolsEnabled = (plugin: string, enabled: boolean): Promise<unknown> =>
  sendRequest('config.setAllToolsEnabled', { plugin, enabled });

/** Toggle a browser tool's enabled state */
const setBrowserToolEnabled = (tool: string, enabled: boolean): Promise<unknown> =>
  sendRequest('config.setBrowserToolEnabled', { tool, enabled });

/** Toggle all browser tools' enabled state in a single batch request */
const setAllBrowserToolsEnabled = (enabled: boolean): Promise<unknown> =>
  sendRequest('config.setAllBrowserToolsEnabled', { enabled });

/** Search npm registry for plugins matching the given query */
const searchPlugins = (query: string): Promise<{ results: PluginSearchResult[] }> =>
  sendRequest('plugin.search', { query }) as Promise<{ results: PluginSearchResult[] }>;

/** Install a plugin by package name */
const installPlugin = (name: string): Promise<PluginInstallResult> =>
  sendRequest('plugin.install', { name }) as Promise<PluginInstallResult>;

/** Remove an installed plugin by name */
const removePlugin = (name: string): Promise<{ ok: true }> =>
  sendRequest('plugin.remove', { name }) as Promise<{ ok: true }>;

/** Update an installed plugin to the latest registry version */
const updatePlugin = (name: string): Promise<PluginInstallResult> =>
  sendRequest('plugin.updateFromRegistry', { name }) as Promise<PluginInstallResult>;

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

export type { BrowserToolState, FailedPluginState, PluginInstallResult, PluginSearchResult, PluginState, WireToolDef };
export {
  getConnectionState,
  fetchConfigState,
  extractShortName,
  matchesPlugin,
  matchesTool,
  setToolEnabled,
  setAllToolsEnabled,
  setBrowserToolEnabled,
  setAllBrowserToolsEnabled,
  searchPlugins,
  installPlugin,
  removePlugin,
  updatePlugin,
  handleServerResponse,
  rejectAllPending,
  sendConfirmationResponse,
};
