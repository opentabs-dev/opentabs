/**
 * Extension WebSocket message handlers.
 * Each handler processes a specific JSON-RPC method from the Chrome extension.
 * Exported individually so they can be unit tested independently of the
 * handleExtensionMessage router in extension-protocol.ts.
 */

import { appendLog } from './log-buffer.js';
import { log } from './logger.js';
import {
  searchNpmPlugins,
  installPlugin,
  updatePlugin,
  removePlugin,
  checkPluginUpdates,
} from './plugin-management.js';
import {
  prefixedToolName,
  isToolEnabled,
  getNextRequestId,
  DISPATCH_TIMEOUT_MS,
  MAX_DISPATCH_TIMEOUT_MS,
} from './state.js';
import type { PluginLogEntry } from './log-buffer.js';
import type { RegisteredPlugin, ServerState, TabMapping, ConfirmationScope, SessionPermissionRule } from './state.js';
import type {
  ConfigSetAllToolsEnabledParams,
  ConfigSetToolEnabledParams,
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResult,
  TabSyncAllParams,
} from '@opentabs-dev/shared';

/** Callbacks the extension protocol can invoke on the MCP side */
interface McpCallbacks {
  onToolConfigChanged: () => void;
  onToolConfigPersist: () => void;
  onPluginLog: (entry: PluginLogEntry) => void;
  onReload: () => Promise<{ plugins: number; durationMs: number }>;
}

/**
 * Send a JSON-serialized message to the extension WebSocket if connected.
 * Centralizes the null check on state.extensionWs so callers don't repeat it.
 * Returns true if the message was sent, false if the extension is not connected.
 */
const sendToExtension = (
  state: ServerState,
  msg: JsonRpcNotification | JsonRpcResult | JsonRpcRequest | JsonRpcError,
): boolean => {
  if (!state.extensionWs) return false;
  try {
    state.extensionWs.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    log.warn('Failed to send to extension:', err);
    return false;
  }
};

/**
 * Send a JSON-RPC error response to the extension.
 * Shorthand for the common pattern of sending { jsonrpc: '2.0', error: { code, message }, id }.
 */
const sendJsonRpcError = (state: ServerState, id: string | number, code: number, message: string): void => {
  sendToExtension(state, { jsonrpc: '2.0', error: { code, message }, id });
};

/**
 * Extract error details from a caught plugin management error and send a JSON-RPC error response.
 * Handles code, message, data, and retryAfterMs fields that plugin management functions may throw.
 */
const sendPluginManagementError = (state: ServerState, id: string | number, err: unknown): void => {
  const code = typeof (err as Record<string, unknown>).code === 'number' ? (err as { code: number }).code : -32603;
  const message = err instanceof Error ? err.message : 'Unknown error';
  const rawData = (err as Record<string, unknown>).data;
  const data = typeof rawData === 'object' && rawData !== null ? (rawData as Record<string, unknown>) : undefined;
  const retryAfterMs =
    typeof (err as Record<string, unknown>).retryAfterMs === 'number'
      ? (err as { retryAfterMs: number }).retryAfterMs
      : undefined;
  const errorData = { ...(data ?? {}), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  const hasData = Object.keys(errorData).length > 0;
  sendToExtension(state, {
    jsonrpc: '2.0',
    error: { code, message, ...(hasData ? { data: errorData } : {}) },
    id,
  });
};

/**
 * Serialize a plugin's metadata and tools into the wire format sent to the extension.
 * Returns the common core shape shared by sync.full, plugin.update, and config.getState.
 * Callers can spread additional fields on top (e.g., sourcePath, adapterHash for sync messages,
 * or tabState, source, sdkVersion for config.getState).
 */
const serializePluginForExtension = (
  plugin: RegisteredPlugin,
  state: ServerState,
): {
  name: string;
  version: string;
  displayName: string;
  urlPatterns: string[];
  trustTier: string;
  iconSvg?: string;
  iconInactiveSvg?: string;
  tools: {
    name: string;
    displayName: string;
    description: string;
    icon: string;
    iconSvg?: string;
    iconInactiveSvg?: string;
    enabled: boolean;
  }[];
} => ({
  name: plugin.name,
  version: plugin.version,
  displayName: plugin.displayName,
  urlPatterns: plugin.urlPatterns,
  trustTier: plugin.trustTier,
  ...(plugin.iconSvg ? { iconSvg: plugin.iconSvg } : {}),
  ...(plugin.iconInactiveSvg ? { iconInactiveSvg: plugin.iconInactiveSvg } : {}),
  tools: plugin.tools.map(t => ({
    name: t.name,
    displayName: t.displayName,
    description: t.description,
    icon: t.icon,
    ...(t.iconSvg ? { iconSvg: t.iconSvg } : {}),
    ...(t.iconInactiveSvg ? { iconInactiveSvg: t.iconInactiveSvg } : {}),
    enabled: isToolEnabled(state, prefixedToolName(plugin.name, t.name)),
  })),
});

// --- Tab handlers ---

/** Wire shape for tab mapping entries — all fields may be absent or wrong type */
interface WireTabMapping {
  state?: string;
  tabId?: number | null;
  url?: string | null;
}

const parseTabMapping = (wire: WireTabMapping): TabMapping => ({
  state: wire.state === 'closed' || wire.state === 'unavailable' || wire.state === 'ready' ? wire.state : 'closed',
  tabId: typeof wire.tabId === 'number' ? wire.tabId : null,
  url: typeof wire.url === 'string' ? wire.url : null,
});

const handleTabSyncAll = (state: ServerState, params: Record<string, unknown> | undefined): void => {
  if (!params) return;
  const tabSyncParams = params as Partial<TabSyncAllParams>;
  const tabs = tabSyncParams.tabs;
  if (!tabs) return;

  state.tabMapping.clear();
  for (const [pluginName, mapping] of Object.entries(tabs)) {
    state.tabMapping.set(pluginName, parseTabMapping(mapping as WireTabMapping));
  }

  log.info(`tab.syncAll received — ${state.tabMapping.size} plugin(s) mapped`);
};

const handleTabStateChanged = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id?: string | number,
): void => {
  const sendError = (message: string): void => {
    if (id !== undefined) {
      sendJsonRpcError(state, id, -32602, message);
    } else {
      log.warn(`tab.stateChanged: ${message}`);
    }
  };

  if (!params) {
    sendError('Missing params');
    return;
  }

  const plugin = params.plugin;
  if (typeof plugin !== 'string' || plugin.length === 0) {
    sendError('Missing or invalid "plugin" field (expected non-empty string)');
    return;
  }

  if (!state.registry.plugins.has(plugin)) {
    sendError(`Unknown plugin: ${plugin}`);
    return;
  }

  if (typeof params.state !== 'string') {
    sendError('Missing or invalid "state" field (expected string)');
    return;
  }

  if (params.state !== 'closed' && params.state !== 'unavailable' && params.state !== 'ready') {
    sendError(`Invalid tab state: ${params.state} (expected closed, unavailable, or ready)`);
    return;
  }

  const wire: WireTabMapping = {
    state: params.state,
    tabId: typeof params.tabId === 'number' ? params.tabId : null,
    url: typeof params.url === 'string' ? params.url : null,
  };
  state.tabMapping.set(plugin, parseTabMapping(wire));

  log.info(`tab.stateChanged: ${plugin} → ${wire.state ?? 'unknown'}`);
};

// --- Config handlers ---

const handleConfigGetState = (state: ServerState, id: string | number): void => {
  const outdatedByPkg = new Map(
    state.outdatedPlugins.map(o => [o.name, { latestVersion: o.latestVersion, updateCommand: o.updateCommand }]),
  );

  const plugins = Array.from(state.registry.plugins.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => {
      const tabInfo = state.tabMapping.get(p.name);
      const update = p.npmPackageName ? outdatedByPkg.get(p.npmPackageName) : undefined;
      return {
        ...serializePluginForExtension(p, state),
        source: p.source,
        tabState: tabInfo?.state ?? 'closed',
        ...(p.sdkVersion ? { sdkVersion: p.sdkVersion } : {}),
        ...(update ? { update } : {}),
      };
    });

  sendToExtension(state, {
    jsonrpc: '2.0',
    result: {
      plugins,
      failedPlugins: state.discoveryErrors.map(e => ({ specifier: e.specifier, error: e.error })),
    },
    id,
  });
};

const handleConfigSetToolEnabled = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): void => {
  if (!params) {
    sendJsonRpcError(state, id, -32602, 'Missing params');
    return;
  }

  const toolEnabledParams = params as Partial<ConfigSetToolEnabledParams>;
  const pluginName = toolEnabledParams.plugin;
  const tool = toolEnabledParams.tool;
  const enabled = toolEnabledParams.enabled;

  if (typeof pluginName !== 'string' || typeof tool !== 'string' || typeof enabled !== 'boolean') {
    sendJsonRpcError(state, id, -32602, 'Invalid params: expected plugin (string), tool (string), enabled (boolean)');
    return;
  }

  const plugin = state.registry.plugins.get(pluginName);
  if (!plugin) {
    sendJsonRpcError(state, id, -32602, `Plugin not found: ${pluginName}`);
    return;
  }

  if (!plugin.tools.some(t => t.name === tool)) {
    sendJsonRpcError(state, id, -32602, `Tool not found: ${tool} in plugin ${pluginName}`);
    return;
  }

  const prefixed = prefixedToolName(pluginName, tool);
  state.toolConfig[prefixed] = enabled;
  callbacks.onToolConfigChanged();
  callbacks.onToolConfigPersist();

  sendToExtension(state, {
    jsonrpc: '2.0',
    result: { ok: true },
    id,
  });
};

const handleConfigSetAllToolsEnabled = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): void => {
  if (!params) {
    sendJsonRpcError(state, id, -32602, 'Missing params');
    return;
  }

  const allToolsEnabledParams = params as Partial<ConfigSetAllToolsEnabledParams>;
  const pluginName = allToolsEnabledParams.plugin;
  const enabled = allToolsEnabledParams.enabled;

  if (typeof pluginName !== 'string' || typeof enabled !== 'boolean') {
    sendJsonRpcError(state, id, -32602, 'Invalid params: expected plugin (string), enabled (boolean)');
    return;
  }

  const plugin = state.registry.plugins.get(pluginName);
  if (!plugin) {
    sendJsonRpcError(state, id, -32602, `Plugin not found: ${pluginName}`);
    return;
  }

  for (const tool of plugin.tools) {
    const prefixed = prefixedToolName(pluginName, tool.name);
    state.toolConfig[prefixed] = enabled;
  }
  callbacks.onToolConfigChanged();
  callbacks.onToolConfigPersist();

  sendToExtension(state, {
    jsonrpc: '2.0',
    result: { ok: true },
    id,
  });
};

// --- Tool progress handler ---

/**
 * Handle tool.progress notification from the extension.
 * Looks up the pending dispatch by dispatchId, invokes the onProgress callback
 * to emit an MCP ProgressNotification to the client, and resets the dispatch
 * timeout timer (the tool is alive). The timer reset is bounded by
 * MAX_DISPATCH_TIMEOUT_MS — if the dispatch has been running longer than the
 * absolute maximum, it is rejected immediately regardless of progress.
 */
const handleToolProgress = (state: ServerState, params: Record<string, unknown> | undefined): void => {
  if (!params) return;

  const dispatchId = params.dispatchId;
  if (typeof dispatchId !== 'string') return;

  const progress = params.progress;
  const total = params.total;
  if (typeof progress !== 'number' || typeof total !== 'number') return;

  const message = typeof params.message === 'string' ? params.message : undefined;

  const pending = state.pendingDispatches.get(dispatchId);
  if (!pending) return;

  pending.lastProgressTs = Date.now();

  // Forward the progress notification to the MCP client
  if (pending.onProgress) {
    try {
      pending.onProgress(progress, total, message);
    } catch {
      // Fire-and-forget — errors in the progress chain must not affect tool execution
    }
  }

  // Reset the dispatch timeout — the tool is alive and making progress.
  // Bounded by MAX_DISPATCH_TIMEOUT_MS from the dispatch start time.
  clearTimeout(pending.timerId);
  const elapsed = Date.now() - pending.startTs;
  const remainingMax = MAX_DISPATCH_TIMEOUT_MS - elapsed;

  if (remainingMax <= 0) {
    // Absolute max exceeded — reject immediately
    state.pendingDispatches.delete(dispatchId);
    pending.reject(
      new Error(`Dispatch ${pending.label} exceeded absolute max timeout of ${MAX_DISPATCH_TIMEOUT_MS}ms`),
    );
    return;
  }

  const nextTimeout = Math.min(DISPATCH_TIMEOUT_MS, remainingMax);
  pending.timerId = setTimeout(() => {
    if (state.pendingDispatches.has(dispatchId)) {
      state.pendingDispatches.delete(dispatchId);
      pending.reject(new Error(`Dispatch ${pending.label} timed out after ${DISPATCH_TIMEOUT_MS}ms`));
    }
  }, nextTimeout);
};

// --- Plugin log handler ---

/** Valid plugin log levels (matches MCP LoggingLevel subset used by the SDK) */
const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warning', 'error']);

const handlePluginLog = (params: Record<string, unknown> | undefined, callbacks: McpCallbacks): void => {
  if (!params) return;

  const plugin = params.plugin;
  const level = params.level;
  const message = params.message;

  if (typeof plugin !== 'string' || plugin.length === 0) return;
  if (typeof level !== 'string' || !VALID_LOG_LEVELS.has(level)) return;
  if (typeof message !== 'string') return;

  const ts = typeof params.ts === 'string' ? params.ts : new Date().toISOString();

  const entry: PluginLogEntry = {
    level,
    plugin,
    message,
    data: params.data,
    ts,
  };

  appendLog(plugin, entry);
  callbacks.onPluginLog(entry);
};

// --- Confirmation handler ---

/** Valid values for ConfirmationScope — used to validate extension input */
const VALID_CONFIRMATION_SCOPES = new Set<ConfirmationScope>(['tool_domain', 'tool_all', 'domain_all']);

/**
 * Handle a confirmation.response from the extension.
 * Resolves the pending confirmation promise with the user's decision.
 * For 'allow_always', also adds a session permission rule.
 */
const handleConfirmationResponse = (state: ServerState, params: Record<string, unknown> | undefined): void => {
  if (!params) return;

  const id = params.id;
  if (typeof id !== 'string') return;

  const decision = params.decision;
  if (decision !== 'allow_once' && decision !== 'allow_always' && decision !== 'deny') return;

  const pending = state.pendingConfirmations.get(id);
  if (!pending) return;

  clearTimeout(pending.timerId);
  state.pendingConfirmations.delete(id);

  // For allow_always, add a session permission rule based on the scope
  if (decision === 'allow_always') {
    const rawScope = typeof params.scope === 'string' ? params.scope : '';
    if (rawScope && !VALID_CONFIRMATION_SCOPES.has(rawScope as ConfirmationScope)) {
      log.warn(`Invalid confirmation scope '${rawScope}', falling back to 'tool_domain'`);
    }
    const scope: ConfirmationScope = VALID_CONFIRMATION_SCOPES.has(rawScope as ConfirmationScope)
      ? (rawScope as ConfirmationScope)
      : 'tool_domain';
    const rule: SessionPermissionRule = { tool: pending.tool, domain: pending.domain, scope };

    // Adjust rule fields based on scope
    if (scope === 'tool_all') {
      rule.domain = null;
    } else if (scope === 'domain_all') {
      rule.tool = null;
    }

    state.sessionPermissions.push(rule);
  }

  pending.resolve(decision);
};

/**
 * Reject all pending confirmations. Called when the extension disconnects
 * to clean up any confirmation promises that can no longer be fulfilled.
 */
const rejectAllPendingConfirmations = (state: ServerState): void => {
  for (const [id, pending] of state.pendingConfirmations) {
    clearTimeout(pending.timerId);
    pending.reject(new Error('Extension disconnected — confirmation cancelled'));
    state.pendingConfirmations.delete(id);
  }
};

// --- Plugin management handlers ---

const handlePluginSearch = async (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
): Promise<void> => {
  const query = params?.query;
  if (query !== undefined && typeof query !== 'string') {
    sendJsonRpcError(state, id, -32602, 'Invalid params: query must be a string if provided');
    return;
  }

  try {
    const results = await searchNpmPlugins(query ?? undefined);
    sendToExtension(state, {
      jsonrpc: '2.0',
      result: { results },
      id,
    });
  } catch (err) {
    sendPluginManagementError(state, id, err);
  }
};

const handlePluginInstall = async (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): Promise<void> => {
  if (!params || typeof params.name !== 'string' || params.name.length === 0) {
    sendJsonRpcError(state, id, -32602, 'Invalid params: name must be a non-empty string');
    return;
  }

  try {
    const result = await installPlugin(params.name, state, callbacks.onReload);

    // Notify the side panel so the UI refreshes with the new plugin
    sendToExtension(state, { jsonrpc: '2.0', method: 'plugins.changed', params: {} });

    sendToExtension(state, {
      jsonrpc: '2.0',
      result,
      id,
    });
  } catch (err) {
    sendPluginManagementError(state, id, err);
  }
};

const handlePluginUpdateFromRegistry = async (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): Promise<void> => {
  if (!params || typeof params.name !== 'string' || params.name.length === 0) {
    sendJsonRpcError(state, id, -32602, 'Invalid params: name must be a non-empty string');
    return;
  }

  try {
    const result = await updatePlugin(params.name, state, callbacks.onReload);

    // Notify the side panel so the UI refreshes
    sendToExtension(state, { jsonrpc: '2.0', method: 'plugins.changed', params: {} });

    sendToExtension(state, {
      jsonrpc: '2.0',
      result,
      id,
    });
  } catch (err) {
    sendPluginManagementError(state, id, err);
  }
};

const handlePluginRemove = async (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): Promise<void> => {
  if (!params || typeof params.name !== 'string' || params.name.length === 0) {
    sendJsonRpcError(state, id, -32602, 'Invalid params: name must be a non-empty string');
    return;
  }

  try {
    const pluginName = params.name;
    const result = await removePlugin(pluginName, state, callbacks.onReload);

    // Send plugin.uninstall to extension to clean up adapters in matching tabs
    sendToExtension(state, {
      jsonrpc: '2.0',
      method: 'plugin.uninstall',
      params: { name: pluginName },
      id: getNextRequestId(),
    });

    // Notify the side panel so the UI refreshes
    sendToExtension(state, { jsonrpc: '2.0', method: 'plugins.changed', params: {} });

    sendToExtension(state, {
      jsonrpc: '2.0',
      result,
      id,
    });
  } catch (err) {
    sendPluginManagementError(state, id, err);
  }
};

const handlePluginCheckUpdates = async (state: ServerState, id: string | number): Promise<void> => {
  try {
    const result = await checkPluginUpdates(state);
    sendToExtension(state, {
      jsonrpc: '2.0',
      result,
      id,
    });
  } catch (err) {
    sendPluginManagementError(state, id, err);
  }
};

export type { McpCallbacks, WireTabMapping };
export {
  sendToExtension,
  sendJsonRpcError,
  sendPluginManagementError,
  serializePluginForExtension,
  parseTabMapping,
  VALID_LOG_LEVELS,
  handleTabSyncAll,
  handleTabStateChanged,
  handleConfigGetState,
  handleConfigSetToolEnabled,
  handleConfigSetAllToolsEnabled,
  handlePluginSearch,
  handlePluginInstall,
  handlePluginUpdateFromRegistry,
  handlePluginRemove,
  handlePluginCheckUpdates,
  handleToolProgress,
  handlePluginLog,
  handleConfirmationResponse,
  rejectAllPendingConfirmations,
};
