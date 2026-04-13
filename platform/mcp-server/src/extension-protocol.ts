/**
 * Extension WebSocket protocol handler.
 * Handles JSON-RPC dispatch mechanics and message routing between the MCP
 * server and Chrome extension. Individual message handlers live in
 * extension-handlers.ts.
 */

import type { JsonRpcNotification, JsonRpcRequest, WsHandle } from '@opentabs-dev/shared';
import { toErrorMessage } from '@opentabs-dev/shared';
import {
  ADAPTER_WRITE_TIMEOUT_MS,
  cleanupStaleAdapterFiles,
  cleanupStaleExecFiles,
  deleteExecFile,
  ensureAdaptersDir,
  timeoutRace,
  writeAdapterFile,
  writeExecFile,
} from './adapter-files.js';
import type { McpCallbacks } from './extension-handlers.js';
import {
  buildConfigStatePayload,
  handleConfigGetState,
  handleConfigSetPluginPermission,
  handleConfigSetPluginSettings,
  handleConfigSetSkipPermissions,
  handleConfigSetToolPermission,
  handleConfirmationResponse,
  handleFolderOpen,
  handlePluginCheckUpdates,
  handlePluginInstall,
  handlePluginLog,
  handlePluginRemove,
  handlePluginRemoveBySpecifier,
  handlePluginSearch,
  handlePluginUpdateFromRegistry,
  handleTabStateChanged,
  handleTabSyncAll,
  handleToolProgress,
  rejectAllPendingConfirmations,
  sendJsonRpcError,
  sendToExtension,
  serializePluginForExtension,
} from './extension-handlers.js';
import { log } from './logger.js';
import { resolvePluginSettings } from './settings-resolver.js';
import type { ConfirmationDecision, ExtensionConnection, PendingDispatch, ServerState } from './state.js';
import {
  DISPATCH_TIMEOUT_MS,
  findConnectionByWs,
  getAnyConnection,
  getConnectionForTab,
  getNextRequestId,
} from './state.js';
import { getSessionId, trackEvent } from './telemetry.js';

/** Maximum incoming WebSocket message size (10MB) */
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;

/**
 * Write adapter IIFE files for all plugins in the registry.
 * Ensures the adapters/ directory exists, cleans up stale files for removed
 * plugins, and writes each plugin's IIFE to a content-hashed file.
 * Returns a Map of plugin name → adapter file path for successful writes.
 *
 * Called eagerly during server startup (via reloadCore) so adapter files
 * exist on disk before the extension connects, and again from sendSyncFull
 * when the extension is connected.
 */
const writeAllAdapterFiles = async (state: ServerState): Promise<Map<string, string>> => {
  const pluginList = Array.from(state.registry.plugins.values());
  await ensureAdaptersDir(state);

  const currentPluginNames = new Set(pluginList.map(p => p.name));
  await cleanupStaleAdapterFiles(currentPluginNames);

  const writePromise = Promise.allSettled(pluginList.map(p => writeAdapterFile(p.name, p.iife, p.iifeSourceMap)));
  const timeout = timeoutRace<null>(null, ADAPTER_WRITE_TIMEOUT_MS);
  const writeResults = await Promise.race([writePromise, timeout.promise]);
  timeout.cancel();

  const adapterFileMap = new Map<string, string>();
  if (writeResults === null) {
    log.warn(
      `Adapter file writes did not complete within ${ADAPTER_WRITE_TIMEOUT_MS}ms. Pending plugins: ${pluginList.map(p => p.name).join(', ')}`,
    );
  } else {
    for (const [i, result] of writeResults.entries()) {
      const plugin = pluginList[i];
      if (result.status === 'rejected') {
        log.warn(`Failed to write adapter file for ${plugin?.name ?? 'unknown'}:`, result.reason);
      } else if (plugin) {
        adapterFileMap.set(plugin.name, result.value);
      }
    }
  }

  return adapterFileMap;
};

/**
 * Send sync.full notification to extension on connect.
 * Writes all plugin adapter IIFEs to the extension's adapters/ directory,
 * then sends plugin metadata (without IIFE content) to the extension.
 */
const sendSyncFull = async (state: ServerState): Promise<void> => {
  const adapterFileMap = await writeAllAdapterFiles(state);
  const pluginList = Array.from(state.registry.plugins.values());

  // Build the full config state payload to include server-owned fields
  // (failedPlugins, browserTools, serverVersion, per-plugin source/sdkVersion/update)
  // alongside the sync-specific fields (sourcePath, adapterHash, adapterFile).
  const configState = buildConfigStatePayload(state);
  const configPluginMap = new Map(configState.plugins.map(p => [p.name, p]));

  const plugins = pluginList.map(p => {
    const configPlugin = configPluginMap.get(p.name);
    return {
      ...serializePluginForExtension(state, p),
      sourcePath: p.sourcePath,
      adapterHash: p.adapterHash,
      adapterFile: adapterFileMap.get(p.name),
      source: configPlugin?.source ?? p.source,
      ...(configPlugin?.sdkVersion ? { sdkVersion: configPlugin.sdkVersion } : {}),
      ...(configPlugin?.update ? { update: configPlugin.update } : {}),
      ...(configPlugin?.configSchema ? { configSchema: configPlugin.configSchema } : {}),
      ...(configPlugin?.resolvedSettings ? { resolvedSettings: configPlugin.resolvedSettings } : {}),
    };
  });

  const sent = sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'sync.full',
    params: {
      plugins,
      failedPlugins: configState.failedPlugins,
      browserTools: configState.browserTools,
      browserPermission: configState.browserPermission,
      serverVersion: configState.serverVersion,
      serverSourcePath: configState.serverSourcePath,
      skipPermissions: configState.skipPermissions,
      extensionHash: configState.extensionHash,
    },
  });
  if (sent) {
    log.info(`Sent sync.full to extension with ${plugins.length} plugin(s)`);
  } else {
    log.warn('Failed to send sync.full — extension not connected');
  }
};

/** Options for dispatchToExtension beyond the basic method + params */
interface DispatchOptions {
  /** Human-readable description for timeout error messages (e.g., "browser.openTab" or "slack/send_message") */
  label?: string;
  /** Override the dispatch timeout in milliseconds (defaults to DISPATCH_TIMEOUT_MS = 30s) */
  timeoutMs?: number;
  /** MCP progressToken from the tools/call request's _meta — stored on PendingDispatch for progress forwarding */
  progressToken?: string | number;
  /** Callback to emit an MCP ProgressNotification when tool.progress arrives for this dispatch */
  onProgress?: (progress: number, total: number, message?: string) => void;
  /** Plugin name for smart dispatch routing — when set, resolveConnection prefers a connection with a ready tab for this plugin */
  pluginName?: string;
}

/**
 * Resolve which connection should handle a dispatch based on the params.
 * For params with a numeric tabId, finds the connection that owns that tab.
 * Falls back to any available connection when tabId is absent or not found
 * (the extension may have just opened the tab and not yet reported it via tab.syncAll).
 */
const resolveConnection = (
  state: ServerState,
  params: Record<string, unknown>,
  pluginName?: string,
): ExtensionConnection | undefined => {
  if (state.extensionConnections.size === 0) return undefined;
  if (state.extensionConnections.size === 1) {
    return state.extensionConnections.values().next().value as ExtensionConnection;
  }
  // Explicit connection targeting takes priority
  const connectionId = typeof params.connectionId === 'string' ? params.connectionId : undefined;
  if (connectionId !== undefined) {
    const conn = state.extensionConnections.get(connectionId);
    if (conn) return conn;
  }
  // Tab-based routing
  const tabId = typeof params.tabId === 'number' ? params.tabId : undefined;
  if (tabId !== undefined) {
    const conn = getConnectionForTab(state, tabId);
    if (conn) return conn;
  }
  // Plugin-aware routing: prefer a connection with a ready tab for the target plugin
  if (pluginName !== undefined) {
    let bestConn: ExtensionConnection | undefined;
    let bestState: 'ready' | 'unavailable' | 'closed' | undefined;
    for (const conn of state.extensionConnections.values()) {
      const mapping = conn.tabMapping.get(pluginName);
      if (!mapping) continue;
      const s = mapping.state;
      if (s === 'ready') return conn;
      if (s === 'unavailable' && bestState !== 'unavailable') {
        bestConn = conn;
        bestState = 'unavailable';
      } else if (s === 'closed' && bestState === undefined) {
        bestConn = conn;
        bestState = 'closed';
      }
    }
    if (bestConn) return bestConn;
  }
  return getAnyConnection(state);
};

/**
 * Dispatch a JSON-RPC request to ALL active extension connections in parallel,
 * collecting per-connection results. Connections that fail or time out are
 * silently excluded from the results (partial success model).
 *
 * Used by tools that need a merged view across all browser profiles
 * (e.g., browser_list_tabs).
 */
const dispatchToAllConnections = async (
  state: ServerState,
  method: string,
  params: Record<string, unknown>,
  options?: DispatchOptions,
): Promise<{ connectionId: string; result: unknown }[]> => {
  if (state.extensionConnections.size === 0) {
    throw new Error('Extension not connected');
  }

  const opts: DispatchOptions = options ?? {};
  const timeoutMs = opts.timeoutMs ?? DISPATCH_TIMEOUT_MS;
  const entries = Array.from(state.extensionConnections.values());

  const settled = await Promise.allSettled(
    entries.map(conn => {
      const id = getNextRequestId();
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        method,
        params: { ...params, __opentabs_dispatchId: id },
        id,
      };

      return new Promise<unknown>((resolve, reject) => {
        const timerId = setTimeout(() => {
          state.pendingDispatches.delete(id);
          reject(new Error(`Dispatch ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        state.pendingDispatches.set(id, {
          resolve,
          reject,
          label: opts.label ?? method,
          startTs: Date.now(),
          timerId,
          connectionId: conn.connectionId,
        });

        try {
          conn.ws.send(JSON.stringify(msg));
        } catch (err) {
          clearTimeout(timerId);
          state.pendingDispatches.delete(id);
          reject(new Error(`WebSocket send failed: ${toErrorMessage(err)}`));
        }
      });
    }),
  );

  const results: { connectionId: string; result: unknown }[] = [];
  for (const [i, s] of settled.entries()) {
    if (s.status === 'fulfilled') {
      const conn = entries[i];
      if (conn) results.push({ connectionId: conn.connectionId, result: s.value });
    }
  }
  return results;
};

/**
 * Send a JSON-RPC request to the extension and return a promise for the response.
 * Unified dispatch for both browser commands (browser.*, extension.*) and
 * plugin tool dispatches (tool.dispatch).
 *
 * Routes to the connection that owns the target tab (if tabId is in params),
 * falling back to any available connection when the tab isn't found or no
 * tabId is specified.
 */
const dispatchToExtension = (
  state: ServerState,
  method: string,
  params: Record<string, unknown>,
  options?: string | DispatchOptions,
): Promise<unknown> => {
  // Backward-compatible: options can be a string (label) for existing callers
  const opts: DispatchOptions = typeof options === 'string' ? { label: options } : (options ?? {});

  const conn = resolveConnection(state, params, opts.pluginName);
  if (!conn) {
    return Promise.reject(new Error('Extension not connected'));
  }

  const id = getNextRequestId();

  const msg: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params: { ...params, __opentabs_dispatchId: id },
    id,
  };

  const dispatchLabel = opts.label ?? method;
  const timeoutMs = opts.timeoutMs ?? DISPATCH_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => {
      const p = state.pendingDispatches.get(id);
      if (p) {
        state.pendingDispatches.delete(id);
        const elapsed = Date.now() - p.startTs;
        const durationBucket =
          elapsed < 32_000 ? '30s' : elapsed < 65_000 ? '1min' : elapsed < 130_000 ? '2min' : '5min';
        trackEvent('dispatch_timed_out', {
          session_id: getSessionId(),
          had_progress_updates: p.lastProgressTs !== undefined,
          duration_bucket: durationBucket,
        });
        reject(new Error(`Dispatch ${dispatchLabel} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const pending: PendingDispatch = {
      resolve,
      reject,
      label: dispatchLabel,
      startTs: Date.now(),
      timerId,
      progressToken: opts.progressToken,
      onProgress: opts.onProgress,
      connectionId: conn.connectionId,
    };
    state.pendingDispatches.set(id, pending);

    const currentSize = state.pendingDispatches.size;
    if (currentSize > state.peakConcurrentDispatches) {
      state.peakConcurrentDispatches = currentSize;
    }

    log.debug('dispatch → extension:', method, 'id:', id, 'connection:', conn.connectionId);

    try {
      conn.ws.send(JSON.stringify(msg));
    } catch (err) {
      clearTimeout(timerId);
      state.pendingDispatches.delete(id);
      reject(new Error(`WebSocket send failed: ${toErrorMessage(err)}`));
    }
  });
};

/**
 * Send tool.invocationStart notification to extension (for side panel animation).
 */
const sendInvocationStart = (state: ServerState, plugin: string, tool: string): void => {
  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'tool.invocationStart',
    params: { plugin, tool, ts: Date.now() },
  });
};

/**
 * Send tool.invocationEnd notification to extension (for side panel animation).
 */
const sendInvocationEnd = (
  state: ServerState,
  plugin: string,
  tool: string,
  durationMs: number,
  success: boolean,
): void => {
  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'tool.invocationEnd',
    params: { plugin, tool, durationMs, success },
  });
};

/**
 * Send a confirmation request to the extension and return a promise that resolves
 * with the user's decision. The promise rejects on extension disconnect.
 * There is no timeout — the request hangs until the user responds or the
 * WebSocket disconnects (at which point rejectAllPendingConfirmations fires).
 */
const sendConfirmationRequest = (
  state: ServerState,
  tool: string,
  plugin: string,
  params: Record<string, unknown>,
): Promise<ConfirmationDecision> => {
  const id = crypto.randomUUID();

  return new Promise<ConfirmationDecision>((resolve, reject) => {
    state.pendingConfirmations.set(id, {
      resolve,
      reject,
      tool,
      plugin,
      params,
    });

    const sent = sendToExtension(state, {
      jsonrpc: '2.0',
      method: 'confirmation.request',
      params: { id, tool, plugin, params },
    });

    if (!sent) {
      state.pendingConfirmations.delete(id);
      reject(new Error('Extension not connected — cannot request confirmation'));
    }
  });
};

/**
 * Send plugin.update notification to extension with updated plugin metadata.
 * Writes the adapter IIFE to the extension's adapters/ directory first,
 * then sends the notification (without IIFE content) to the extension.
 *
 * Used by file watcher when a local plugin's manifest or IIFE changes on disk,
 * and by the hot reload sequence after re-discovery.
 *
 * Sent as a JSON-RPC notification (no id, no response expected). The extension
 * processes the update and re-injects the adapter into matching tabs.
 */
const sendPluginUpdate = async (
  state: ServerState,
  pluginName: string,
  iife: string,
  sourceMap?: string,
): Promise<void> => {
  const plugin = state.registry.plugins.get(pluginName);
  if (!plugin) return;

  await ensureAdaptersDir(state);
  const adapterFile = await writeAdapterFile(pluginName, iife, sourceMap);

  const userSettings = state.pluginSettings[pluginName];
  const { resolvedValues } = resolvePluginSettings(
    pluginName,
    plugin.urlPatterns,
    plugin.homepage,
    plugin.configSchema,
    userSettings,
  );
  const hasResolvedSettings = Object.keys(resolvedValues).length > 0;

  const sent = sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugin.update',
    params: {
      ...serializePluginForExtension(state, plugin),
      sourcePath: plugin.sourcePath,
      adapterHash: plugin.adapterHash,
      adapterFile,
      ...(plugin.configSchema ? { configSchema: plugin.configSchema } : {}),
      ...(hasResolvedSettings ? { resolvedSettings: resolvedValues } : {}),
    },
  });
  if (!sent) log.warn('Failed to send plugin.update — extension not connected');
};

/**
 * Handle an incoming WebSocket message from the extension.
 * Routes to the appropriate handler based on method/id.
 *
 * @param senderWs - The raw WebSocket that sent this message. Used to reply
 *   pongs on the exact connection that pinged, preventing race conditions
 *   during hot reload when two connections may briefly coexist.
 */
const handleExtensionMessage = (
  state: ServerState,
  text: string,
  callbacks: McpCallbacks,
  senderWs?: WsHandle,
): void => {
  if (text.length > MAX_MESSAGE_SIZE) {
    log.warn(
      `Dropping oversized WebSocket message (${(text.length / 1024 / 1024).toFixed(1)}MB, limit ${MAX_MESSAGE_SIZE / 1024 / 1024}MB)`,
    );
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    log.warn('Dropping malformed WebSocket message (invalid JSON)');
    return;
  }

  const method = typeof parsed.method === 'string' ? parsed.method : undefined;
  const id = typeof parsed.id === 'string' || typeof parsed.id === 'number' ? parsed.id : undefined;

  // Handle ping keepalive — reply on the SAME ws that sent the ping.
  // This is critical during hot reload: if the old connection sends a ping
  // before it's closed, the pong must go back on that specific connection.
  if (method === 'ping') {
    const replyWs = senderWs ?? getAnyConnection(state)?.ws;
    replyWs?.send(JSON.stringify({ jsonrpc: '2.0', method: 'pong' } satisfies JsonRpcNotification));
    return;
  }

  // Handle responses to our requests (tool.dispatch responses)
  if (id !== undefined && !method) {
    const pending = state.pendingDispatches.get(id);
    if (!pending) return;

    state.pendingDispatches.delete(id);
    clearTimeout(pending.timerId);
    log.debug('dispatch ← extension:', pending.label, 'id:', id, 'in', `${Date.now() - pending.startTs}ms`);

    if ('error' in parsed) {
      const rawErr = parsed.error;
      const errObj =
        rawErr !== null && typeof rawErr === 'object' && !Array.isArray(rawErr)
          ? (rawErr as Record<string, unknown>)
          : {};
      const errCode = typeof errObj.code === 'number' ? errObj.code : -32603;
      const errMsg = typeof errObj.message === 'string' ? errObj.message : 'Unknown extension error';
      const errData =
        errObj.data !== null &&
        errObj.data !== undefined &&
        typeof errObj.data === 'object' &&
        !Array.isArray(errObj.data)
          ? (errObj.data as Record<string, unknown>)
          : undefined;
      const error = new DispatchError(errMsg, errCode, errData);
      pending.reject(error);
    } else {
      pending.resolve(parsed.result);
    }
    return;
  }

  // Validate params: must be a plain object (or undefined/null) per JSON-RPC spec.
  // Reject arrays, primitives, and other non-object types before method handlers.
  const rawParams = parsed.params;
  if (rawParams !== undefined && rawParams !== null && (typeof rawParams !== 'object' || Array.isArray(rawParams))) {
    log.warn(`Dropping message with non-object params: ${method ?? '(no method)'}`);
    return;
  }
  const params = rawParams as Record<string, unknown> | undefined;

  // Resolve which connection sent this message (needed for per-connection tab scoping)
  const senderConn = senderWs ? findConnectionByWs(state, senderWs) : getAnyConnection(state);

  // Route to individual handlers in extension-handlers.ts

  // Self-healing: extension requests full re-sync when adapter files are missing on disk.
  if (method === 'sync.requestFull') {
    log.info('Extension requested full re-sync (adapter files likely missing)');
    void sendSyncFull(state).catch((err: unknown) => {
      log.error('Failed to re-sync after sync.requestFull:', err);
    });
    return;
  }

  if (method === 'tab.syncAll') {
    handleTabSyncAll(params, senderConn);
    return;
  }

  if (method === 'tab.stateChanged') {
    handleTabStateChanged(state, params, id, senderConn);
    return;
  }

  if (method === 'config.getState' && id !== undefined) {
    handleConfigGetState(state, id);
    return;
  }

  if (method === 'config.setToolPermission' && id !== undefined) {
    handleConfigSetToolPermission(state, params, id, callbacks);
    return;
  }

  if (method === 'config.setPluginPermission' && id !== undefined) {
    handleConfigSetPluginPermission(state, params, id, callbacks);
    return;
  }

  if (method === 'config.setSkipPermissions' && id !== undefined) {
    handleConfigSetSkipPermissions(state, params, id, callbacks);
    return;
  }

  if (method === 'config.setPluginSettings' && id !== undefined) {
    void handleConfigSetPluginSettings(state, params, id, callbacks);
    return;
  }

  if (method === 'plugin.search' && id !== undefined) {
    void handlePluginSearch(state, params, id);
    return;
  }

  if (method === 'plugin.install' && id !== undefined) {
    void handlePluginInstall(state, params, id, callbacks);
    return;
  }

  if (method === 'plugin.updateFromRegistry' && id !== undefined) {
    void handlePluginUpdateFromRegistry(state, params, id, callbacks);
    return;
  }

  if (method === 'plugin.remove' && id !== undefined) {
    void handlePluginRemove(state, params, id, callbacks);
    return;
  }

  if (method === 'plugin.removeBySpecifier' && id !== undefined) {
    void handlePluginRemoveBySpecifier(state, params, id, callbacks);
    return;
  }

  if (method === 'plugin.checkUpdates' && id !== undefined) {
    void handlePluginCheckUpdates(state, id);
    return;
  }

  if (method === 'folder.open' && id !== undefined) {
    void handleFolderOpen(state, params, id);
    return;
  }

  if (method === 'tool.progress') {
    handleToolProgress(state, params);
    return;
  }

  if (method === 'plugin.log') {
    handlePluginLog(params, callbacks);
    return;
  }

  if (method === 'confirmation.response') {
    handleConfirmationResponse(state, params);
    return;
  }

  // Unrecognized method with an id — send JSON-RPC -32601 'Method not found'
  if (id !== undefined && method) {
    sendJsonRpcError(state, id, -32601, `Method not found: ${method}`);
    return;
  }

  // Unrecognized notification or malformed message
  if (method) {
    log.warn(`Ignoring unrecognized notification: ${method}`);
  } else if (id === undefined) {
    log.warn('Dropping unrecognized WebSocket message (no method, no id)');
  }
};

/**
 * Error class for tool dispatch errors with JSON-RPC error codes.
 *
 * Not exported — consumers must use isDispatchError() for type narrowing.
 * On hot reload, each module re-evaluation creates a new class identity,
 * so `instanceof DispatchError` fails across reload boundaries. The duck-typed
 * isDispatchError() guard is co-located here to make the correct approach
 * obvious and the incorrect approach (importing the class) impossible.
 */
class DispatchError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

/**
 * Check if an error is a DispatchError by duck-typing rather than instanceof.
 *
 * On hot reload, each module re-evaluation creates a new DispatchError class.
 * If a tool dispatch timeout fires after hot reload, the error is an instance of
 * the OLD module's DispatchError class. Using `instanceof` against the NEW
 * module's DispatchError would fail, causing the error to fall through to the
 * generic catch branch and lose the specific error code/message. Duck-typing
 * avoids this cross-reload class identity problem.
 */
const isDispatchError = (
  err: unknown,
): err is { name: string; message: string; code: number; data?: Record<string, unknown> } =>
  err !== null &&
  typeof err === 'object' &&
  'code' in err &&
  'name' in err &&
  (err as { name: unknown }).name === 'DispatchError';

/**
 * Query the extension with a JSON-RPC request and return the response.
 * Uses the standard dispatch mechanism (pendingDispatches) with a configurable timeout.
 * Falls back cleanly on timeout or error — callers should catch and use cached data.
 */
const queryExtension = (
  state: ServerState,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 2000,
): Promise<unknown> => dispatchToExtension(state, method, params, { timeoutMs, label: method });

/**
 * Send extension.reload JSON-RPC notification to trigger chrome.runtime.reload()
 * in the connected extension. Used when the server detects that the managed
 * extension files were updated (version change).
 */
const sendExtensionReload = (state: ServerState): boolean =>
  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'extension.reload',
  });

export type { McpCallbacks };
export {
  cleanupStaleExecFiles,
  deleteExecFile,
  dispatchToAllConnections,
  dispatchToExtension,
  handleExtensionMessage,
  isDispatchError,
  queryExtension,
  rejectAllPendingConfirmations,
  sendConfirmationRequest,
  sendExtensionReload,
  sendInvocationEnd,
  sendInvocationStart,
  sendPluginUpdate,
  sendSyncFull,
  writeAdapterFile,
  writeAllAdapterFiles,
  writeExecFile,
};
