/**
 * Extension WebSocket protocol handler.
 * Handles JSON-RPC messages between the MCP server and Chrome extension.
 */

import type {
  ServerState,
  TabMapping,
  PendingDispatch,
} from "./state.js";
import { prefixedToolName, isToolEnabled } from "./state.js";

/** JSON-RPC 2.0 error response */
interface JsonRpcError {
  jsonrpc: "2.0";
  error: { code: number; message: string };
  id: string | number | null;
}

/** JSON-RPC 2.0 success response */
interface JsonRpcResult {
  jsonrpc: "2.0";
  result: unknown;
  id: string | number;
}

/** JSON-RPC 2.0 notification (no id) */
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 request (has id) */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id: string | number;
}

type JsonRpcMessage = JsonRpcError | JsonRpcResult | JsonRpcNotification | JsonRpcRequest;

/** Callbacks the extension protocol can invoke on the MCP side */
export interface McpCallbacks {
  onToolConfigChanged: () => void;
  onToolConfigPersist: () => void;
}

/**
 * Send sync.full notification to extension on connect.
 * Contains all plugins with their IIFEs, tools, and enabled states.
 */
export const sendSyncFull = (state: ServerState): void => {
  if (!state.extensionWs) return;

  const plugins = Array.from(state.plugins.values()).map((p) => ({
    name: p.name,
    version: p.version,
    displayName: p.displayName,
    urlPatterns: p.urlPatterns,
    trustTier: p.trustTier,
    sourcePath: p.sourcePath,
    iife: p.iife,
    tools: p.tools.map((t) => ({
      name: t.name,
      description: t.description,
      enabled: isToolEnabled(state, prefixedToolName(p.name, t.name)),
    })),
  }));

  const msg: JsonRpcNotification = {
    jsonrpc: "2.0",
    method: "sync.full",
    params: { plugins },
  };

  state.extensionWs.send(JSON.stringify(msg));
};

/**
 * Send tool.dispatch request to extension and return a promise for the response.
 */
export const dispatchToolToExtension = (
  state: ServerState,
  plugin: string,
  tool: string,
  input: Record<string, unknown>
): Promise<unknown> => {
  if (!state.extensionWs) {
    return Promise.reject(new Error("Extension not connected"));
  }

  const id = state.nextRequestId++;

  const msg: JsonRpcRequest = {
    jsonrpc: "2.0",
    method: "tool.dispatch",
    params: { plugin, tool, input },
    id,
  };

  return new Promise((resolve, reject) => {
    const pending: PendingDispatch = {
      resolve,
      reject,
      plugin,
      tool,
      startTs: Date.now(),
    };
    state.pendingDispatches.set(id, pending);

    // Timeout after 30 seconds
    setTimeout(() => {
      if (state.pendingDispatches.has(id)) {
        state.pendingDispatches.delete(id);
        reject(new Error("Tool dispatch timed out"));
      }
    }, 30_000);

    state.extensionWs!.send(JSON.stringify(msg));
  });
};

/**
 * Send tool.invocationStart notification to extension (for side panel animation).
 */
export const sendInvocationStart = (
  state: ServerState,
  plugin: string,
  tool: string
): void => {
  if (!state.extensionWs) return;

  const msg: JsonRpcNotification = {
    jsonrpc: "2.0",
    method: "tool.invocationStart",
    params: { plugin, tool, ts: Date.now() },
  };

  state.extensionWs.send(JSON.stringify(msg));
};

/**
 * Send tool.invocationEnd notification to extension (for side panel animation).
 */
export const sendInvocationEnd = (
  state: ServerState,
  plugin: string,
  tool: string,
  durationMs: number,
  success: boolean
): void => {
  if (!state.extensionWs) return;

  const msg: JsonRpcNotification = {
    jsonrpc: "2.0",
    method: "tool.invocationEnd",
    params: { plugin, tool, durationMs, success },
  };

  state.extensionWs.send(JSON.stringify(msg));
};

/**
 * Send plugin.update request to extension with updated IIFE.
 * Used by file watcher when a local plugin's IIFE changes on disk.
 */
export const sendPluginUpdate = (
  state: ServerState,
  pluginName: string,
  iife: string
): void => {
  if (!state.extensionWs) return;

  const plugin = state.plugins.get(pluginName);
  if (!plugin) return;

  const id = state.nextRequestId++;

  const msg: JsonRpcRequest = {
    jsonrpc: "2.0",
    method: "plugin.update",
    params: {
      name: plugin.name,
      version: plugin.version,
      displayName: plugin.displayName,
      urlPatterns: plugin.urlPatterns,
      trustTier: plugin.trustTier,
      sourcePath: plugin.sourcePath,
      iife,
      tools: plugin.tools.map((t) => ({
        name: t.name,
        description: t.description,
        enabled: isToolEnabled(state, prefixedToolName(plugin.name, t.name)),
      })),
    },
    id,
  };

  state.extensionWs.send(JSON.stringify(msg));
};

/**
 * Handle an incoming WebSocket message from the extension.
 * Routes to the appropriate handler based on method/id.
 *
 * @param senderWs - The raw WebSocket that sent this message. Used to reply
 *   pongs on the exact connection that pinged, preventing race conditions
 *   during hot reload when two connections may briefly coexist.
 */
export const handleExtensionMessage = (
  state: ServerState,
  text: string,
  callbacks: McpCallbacks,
  senderWs?: { send: (data: string) => void },
): void => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return; // ignore malformed messages
  }

  const method = parsed.method as string | undefined;
  const id = parsed.id as string | number | undefined;

  // Handle ping keepalive — reply on the SAME ws that sent the ping.
  // This is critical during hot reload: if the old connection sends a ping
  // before it's closed, the pong must go back on that connection (not the
  // new one stored in state.extensionWs).
  if (method === "ping") {
    const replyWs = senderWs ?? state.extensionWs;
    replyWs?.send(
      JSON.stringify({ jsonrpc: "2.0", method: "pong" })
    );
    return;
  }

  // Handle responses to our requests (tool.dispatch responses)
  if (id !== undefined && !method) {
    const pending = state.pendingDispatches.get(id);
    if (!pending) return;

    state.pendingDispatches.delete(id);

    if ("error" in parsed) {
      const err = parsed.error as { code: number; message: string };
      const error = new DispatchError(err.message, err.code);
      pending.reject(error);
    } else {
      pending.resolve(parsed.result);
    }
    return;
  }

  // Handle notifications/requests from extension
  if (method === "tab.syncAll") {
    handleTabSyncAll(state, parsed.params as Record<string, unknown>);
    return;
  }

  if (method === "tab.stateChanged") {
    handleTabStateChanged(state, parsed.params as Record<string, unknown>);
    return;
  }

  // Handle config operations (requests with id from side panel, relayed through extension)
  if (method === "config.getState" && id !== undefined) {
    handleConfigGetState(state, id);
    return;
  }

  if (method === "config.setToolEnabled" && id !== undefined) {
    handleConfigSetToolEnabled(
      state,
      parsed.params as Record<string, unknown>,
      id,
      callbacks
    );
    return;
  }

  if (method === "config.setAllToolsEnabled" && id !== undefined) {
    handleConfigSetAllToolsEnabled(
      state,
      parsed.params as Record<string, unknown>,
      id,
      callbacks
    );
    return;
  }
};

/** Error class for tool dispatch errors with JSON-RPC error codes */
export class DispatchError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = "DispatchError";
  }
}

// --- Internal handlers ---

const handleTabSyncAll = (
  state: ServerState,
  params: Record<string, unknown> | undefined
): void => {
  if (!params) return;
  const tabs = params.tabs as Record<string, TabMapping> | undefined;
  if (!tabs) return;

  state.tabMapping.clear();
  for (const [pluginName, mapping] of Object.entries(tabs)) {
    state.tabMapping.set(pluginName, {
      state: mapping.state ?? "closed",
      tabId: mapping.tabId ?? null,
      url: mapping.url ?? null,
    });
  }

  console.log(
    `[opentabs] tab.syncAll received — ${state.tabMapping.size} plugin(s) mapped`
  );
};

const handleTabStateChanged = (
  state: ServerState,
  params: Record<string, unknown> | undefined
): void => {
  if (!params) return;
  const plugin = params.plugin as string;
  if (!plugin) return;

  state.tabMapping.set(plugin, {
    state: (params.state as TabMapping["state"]) ?? "closed",
    tabId: (params.tabId as number) ?? null,
    url: (params.url as string) ?? null,
  });

  console.log(
    `[opentabs] tab.stateChanged: ${plugin} → ${params.state}`
  );
};

const handleConfigGetState = (
  state: ServerState,
  id: string | number
): void => {
  const plugins = Array.from(state.plugins.values()).map((p) => {
    const tabInfo = state.tabMapping.get(p.name);
    return {
      name: p.name,
      displayName: p.displayName ?? p.name,
      version: p.version,
      trustTier: p.trustTier,
      tabState: tabInfo?.state ?? "closed",
      urlPatterns: p.urlPatterns,
      tools: p.tools.map((t) => ({
        name: t.name,
        description: t.description,
        enabled: isToolEnabled(state, prefixedToolName(p.name, t.name)),
      })),
    };
  });

  const response: JsonRpcResult = {
    jsonrpc: "2.0",
    result: {
      plugins,
      outdatedPlugins: state.outdatedPlugins,
    },
    id,
  };

  state.extensionWs?.send(JSON.stringify(response));
};

const handleConfigSetToolEnabled = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks
): void => {
  if (!params) return;
  const plugin = params.plugin as string;
  const tool = params.tool as string;
  const enabled = params.enabled as boolean;

  if (plugin && tool !== undefined && typeof enabled === "boolean") {
    const prefixed = prefixedToolName(plugin, tool);
    state.toolConfig[prefixed] = enabled;
    callbacks.onToolConfigChanged();
    callbacks.onToolConfigPersist();
  }

  const response: JsonRpcResult = {
    jsonrpc: "2.0",
    result: { ok: true },
    id,
  };

  state.extensionWs?.send(JSON.stringify(response));
};

const handleConfigSetAllToolsEnabled = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks
): void => {
  if (!params) return;
  const pluginName = params.plugin as string;
  const enabled = params.enabled as boolean;

  const plugin = state.plugins.get(pluginName);
  if (plugin && typeof enabled === "boolean") {
    for (const tool of plugin.tools) {
      const prefixed = prefixedToolName(pluginName, tool.name);
      state.toolConfig[prefixed] = enabled;
    }
    callbacks.onToolConfigChanged();
    callbacks.onToolConfigPersist();
  }

  const response: JsonRpcResult = {
    jsonrpc: "2.0",
    result: { ok: true },
    id,
  };

  state.extensionWs?.send(JSON.stringify(response));
};
