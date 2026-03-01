/**
 * Extension WebSocket protocol handler.
 * Handles JSON-RPC dispatch mechanics and message routing between the MCP
 * server and Chrome extension. Individual message handlers live in
 * extension-handlers.ts.
 */

import {
  ensureAdaptersDir,
  writeAdapterFile,
  cleanupStaleAdapterFiles,
  writeExecFile,
  deleteExecFile,
  cleanupStaleExecFiles,
  timeoutRace,
  ADAPTER_WRITE_TIMEOUT_MS,
} from './adapter-files.js';
import {
  sendToExtension,
  sendJsonRpcError,
  serializePluginForExtension,
  handleTabSyncAll,
  handleTabStateChanged,
  handleConfigGetState,
  handleConfigSetToolEnabled,
  handleConfigSetAllToolsEnabled,
  handleConfigSetBrowserToolEnabled,
  handleConfigSetAllBrowserToolsEnabled,
  handlePluginSearch,
  handlePluginInstall,
  handlePluginUpdateFromRegistry,
  handlePluginRemove,
  handlePluginCheckUpdates,
  handleToolProgress,
  handlePluginLog,
  handleConfirmationResponse,
  rejectAllPendingConfirmations,
} from './extension-handlers.js';
import { log } from './logger.js';
import { getNextRequestId, DISPATCH_TIMEOUT_MS, CONFIRMATION_TIMEOUT_MS } from './state.js';
import { toErrorMessage } from '@opentabs-dev/shared';
import type { McpCallbacks } from './extension-handlers.js';
import type { ServerState, PendingDispatch, ConfirmationDecision } from './state.js';
import type { JsonRpcNotification, JsonRpcRequest, WsHandle } from '@opentabs-dev/shared';

/** Maximum incoming WebSocket message size (10MB) */
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;

/**
 * Send sync.full notification to extension on connect.
 * Writes all plugin adapter IIFEs to the extension's adapters/ directory,
 * then sends plugin metadata (without IIFE content) to the extension.
 */
const sendSyncFull = async (state: ServerState): Promise<void> => {
  // Write all adapter IIFEs to disk so the extension can inject them as files.
  // Uses allSettled so a single plugin's write failure doesn't block the sync notification.
  // Races against a timeout so stalled writes don't hang hot reload indefinitely.
  const pluginList = Array.from(state.registry.plugins.values());
  await ensureAdaptersDir(state);

  // Remove stale adapter files from plugins that are no longer in the current set
  const currentPluginNames = new Set(pluginList.map(p => p.name));
  await cleanupStaleAdapterFiles(currentPluginNames);

  const writePromise = Promise.allSettled(pluginList.map(p => writeAdapterFile(p.name, p.iife, p.iifeSourceMap)));
  const timeout = timeoutRace<null>(null, ADAPTER_WRITE_TIMEOUT_MS);
  const writeResults = await Promise.race([writePromise, timeout.promise]);
  timeout.cancel();

  // Collect adapterFile paths from successful writes
  const adapterFileMap = new Map<string, string>();
  if (writeResults === null) {
    log.warn(
      `Adapter file writes did not complete within ${ADAPTER_WRITE_TIMEOUT_MS}ms — sending sync.full with available adapters. Pending plugins: ${pluginList.map(p => p.name).join(', ')}`,
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

  const plugins = pluginList.map(p => ({
    ...serializePluginForExtension(p, state),
    sourcePath: p.sourcePath,
    adapterHash: p.adapterHash,
    adapterFile: adapterFileMap.get(p.name),
  }));

  const sent = sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'sync.full',
    params: { plugins },
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
}

/**
 * Send a JSON-RPC request to the extension and return a promise for the response.
 * Unified dispatch for both browser commands (browser.*, extension.*) and
 * plugin tool dispatches (tool.dispatch).
 */
const dispatchToExtension = (
  state: ServerState,
  method: string,
  params: Record<string, unknown>,
  options?: string | DispatchOptions,
): Promise<unknown> => {
  // Backward-compatible: options can be a string (label) for existing callers
  const opts: DispatchOptions = typeof options === 'string' ? { label: options } : (options ?? {});

  const ws = state.extensionWs;
  if (!ws) {
    return Promise.reject(new Error('Extension not connected'));
  }

  const id = getNextRequestId();

  const msg: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params: { ...params, dispatchId: id },
    id,
  };

  const dispatchLabel = opts.label ?? method;
  const timeoutMs = opts.timeoutMs ?? DISPATCH_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => {
      if (state.pendingDispatches.has(id)) {
        state.pendingDispatches.delete(id);
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
    };
    state.pendingDispatches.set(id, pending);

    log.debug('dispatch → extension:', method, 'id:', id);

    try {
      ws.send(JSON.stringify(msg));
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
 * with the user's decision. The promise rejects on timeout (30s) or extension disconnect.
 *
 * @param state - Server state
 * @param tool - Browser tool name (e.g., 'browser_execute_script')
 * @param domain - Target domain (e.g., 'mail.google.com'), or null
 * @param tabId - Target tab ID, if applicable
 * @param paramsPreview - Truncated preview of tool parameters
 * @returns The user's decision: 'allow_once', 'allow_always', or 'deny'
 */
const sendConfirmationRequest = (
  state: ServerState,
  tool: string,
  domain: string | null,
  tabId: number | undefined,
  paramsPreview: string,
): Promise<ConfirmationDecision> => {
  const id = crypto.randomUUID();

  return new Promise<ConfirmationDecision>((resolve, reject) => {
    const timerId = setTimeout(() => {
      state.pendingConfirmations.delete(id);
      reject(new Error('CONFIRMATION_TIMEOUT'));
    }, CONFIRMATION_TIMEOUT_MS);

    state.pendingConfirmations.set(id, {
      resolve,
      reject,
      timerId,
      tool,
      domain,
      tabId,
    });

    const sent = sendToExtension(state, {
      jsonrpc: '2.0',
      method: 'confirmation.request',
      params: {
        id,
        tool,
        domain,
        tabId,
        paramsPreview,
        timeoutMs: CONFIRMATION_TIMEOUT_MS,
      },
    });

    if (!sent) {
      clearTimeout(timerId);
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

  const sent = sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugin.update',
    params: {
      ...serializePluginForExtension(plugin, state),
      sourcePath: plugin.sourcePath,
      adapterHash: plugin.adapterHash,
      adapterFile,
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
  // before it's closed, the pong must go back on that connection (not the
  // new one stored in state.extensionWs).
  if (method === 'ping') {
    const replyWs = senderWs ?? state.extensionWs;
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

  // Route to individual handlers in extension-handlers.ts
  if (method === 'tab.syncAll') {
    handleTabSyncAll(state, params);
    return;
  }

  if (method === 'tab.stateChanged') {
    handleTabStateChanged(state, params, id);
    return;
  }

  if (method === 'config.getState' && id !== undefined) {
    handleConfigGetState(state, id);
    return;
  }

  if (method === 'config.setToolEnabled' && id !== undefined) {
    handleConfigSetToolEnabled(state, params, id, callbacks);
    return;
  }

  if (method === 'config.setAllToolsEnabled' && id !== undefined) {
    handleConfigSetAllToolsEnabled(state, params, id, callbacks);
    return;
  }

  if (method === 'config.setBrowserToolEnabled' && id !== undefined) {
    handleConfigSetBrowserToolEnabled(state, params, id, callbacks);
    return;
  }

  if (method === 'config.setAllBrowserToolsEnabled' && id !== undefined) {
    handleConfigSetAllBrowserToolsEnabled(state, params, id, callbacks);
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

  if (method === 'plugin.checkUpdates' && id !== undefined) {
    void handlePluginCheckUpdates(state, id);
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
  sendSyncFull,
  dispatchToExtension,
  sendInvocationStart,
  sendInvocationEnd,
  sendConfirmationRequest,
  rejectAllPendingConfirmations,
  sendPluginUpdate,
  handleExtensionMessage,
  isDispatchError,
  writeAdapterFile,
  writeExecFile,
  deleteExecFile,
  cleanupStaleExecFiles,
  sendExtensionReload,
};
