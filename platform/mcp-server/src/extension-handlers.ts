/**
 * Extension WebSocket message handlers.
 * Each handler processes a specific JSON-RPC method from the Chrome extension.
 * Exported individually so they can be unit tested independently of the
 * handleExtensionMessage router in extension-protocol.ts.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ConfigSetPluginPermissionParams,
  ConfigSetToolPermissionParams,
  ConfigStateResult,
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResult,
  PluginTabInfo,
  TabSyncAllParams,
  ToolPermission,
} from '@opentabs-dev/shared';
import { DEFAULT_PORT, isWindows } from '@opentabs-dev/shared';
import open from 'open';
import { getExtensionDir } from './config.js';
import { isDev } from './dev-mode.js';
import type { PluginLogEntry } from './log-buffer.js';
import { appendLog } from './log-buffer.js';
import { log } from './logger.js';
import {
  checkPluginUpdates,
  installPlugin,
  removeFailedPlugin,
  removePlugin,
  searchNpmPlugins,
  updatePlugin,
} from './plugin-management.js';
import { resolvePluginSettings } from './settings-resolver.js';
import type { ExtensionConnection, RegisteredPlugin, ServerState, TabMapping } from './state.js';
import {
  DISPATCH_TIMEOUT_MS,
  getConfiguredToolPermission,
  getMergedTabMapping,
  MAX_DISPATCH_TIMEOUT_MS,
} from './state.js';
import { getSessionId, trackEvent } from './telemetry.js';
import { version } from './version.js';

/** Absolute path to the MCP server's package directory (parent of dist/) */
const serverSourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Valid ToolPermission values for parameter validation */
const VALID_PERMISSIONS = new Set<string>(['off', 'ask', 'auto']);

/** Callbacks the extension protocol can invoke on the MCP side */
interface McpCallbacks {
  onToolConfigChanged: () => void;
  onPluginPermissionsPersist: () => void;
  onPluginSettingsPersist: () => void;
  onPluginLog: (entry: PluginLogEntry) => void;
  onReload: () => Promise<{ plugins: number; durationMs: number }>;
  /** Send a JSON-RPC request to the extension and return the response (with timeout). */
  queryExtension: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
}

/**
 * Broadcast a JSON-serialized message to all connected extension WebSockets.
 * Returns true if the message was sent to at least one connection.
 */
const sendToExtension = (
  state: ServerState,
  msg: JsonRpcNotification | JsonRpcResult | JsonRpcRequest | JsonRpcError,
): boolean => {
  if (state.extensionConnections.size === 0) return false;
  let anySent = false;
  const data = JSON.stringify(msg);
  for (const conn of state.extensionConnections.values()) {
    try {
      conn.ws.send(data);
      anySent = true;
    } catch (err) {
      log.warn(`Failed to send to connection ${conn.connectionId}:`, err);
    }
  }
  return anySent;
};

/**
 * Send a JSON-serialized message to a specific extension connection by ID.
 * Returns true if the message was sent successfully, false if the connection
 * was not found or the send failed.
 */
const sendToConnection = (
  state: ServerState,
  connectionId: string,
  msg: JsonRpcNotification | JsonRpcResult | JsonRpcRequest | JsonRpcError,
): boolean => {
  const conn = state.extensionConnections.get(connectionId);
  if (!conn) return false;
  try {
    conn.ws.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    log.warn(`Failed to send to connection ${connectionId}:`, err);
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
  const errorData = {
    ...(data ?? {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
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
 *
 * The plugin-level permission comes from pluginPermissions[plugin.name]?.permission ?? 'off'.
 * Each tool's permission is resolved via getConfiguredToolPermission() (per-tool override → plugin default → 'off').
 */
const serializePluginForExtension = (
  state: ServerState,
  plugin: RegisteredPlugin,
): {
  name: string;
  version: string;
  displayName: string;
  urlPatterns: string[];
  excludePatterns?: string[];
  homepage?: string;
  npmPackageName?: string;
  permission: ToolPermission;
  reviewed: boolean;
  iconSvg?: string;
  iconInactiveSvg?: string;
  iconDarkSvg?: string;
  iconDarkInactiveSvg?: string;
  instanceMap?: Record<string, string>;
  hasPreScript: boolean;
  tools: {
    name: string;
    displayName: string;
    description: string;
    summary?: string;
    icon: string;
    iconSvg?: string;
    iconInactiveSvg?: string;
    group?: string;
    permission: ToolPermission;
  }[];
} => {
  const pluginConfig = state.pluginPermissions[plugin.name];
  const pluginPermission: ToolPermission = pluginConfig?.permission ?? 'off';

  return {
    name: plugin.name,
    version: plugin.version,
    displayName: plugin.displayName,
    urlPatterns: plugin.urlPatterns,
    ...(plugin.excludePatterns.length > 0 ? { excludePatterns: plugin.excludePatterns } : {}),
    ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
    ...(plugin.npmPackageName ? { npmPackageName: plugin.npmPackageName } : {}),
    permission: pluginPermission,
    reviewed: pluginConfig?.reviewedVersion === plugin.version,
    ...(plugin.iconSvg ? { iconSvg: plugin.iconSvg } : {}),
    ...(plugin.iconInactiveSvg ? { iconInactiveSvg: plugin.iconInactiveSvg } : {}),
    ...(plugin.iconDarkSvg ? { iconDarkSvg: plugin.iconDarkSvg } : {}),
    ...(plugin.iconDarkInactiveSvg ? { iconDarkInactiveSvg: plugin.iconDarkInactiveSvg } : {}),
    ...(plugin.instanceMap ? { instanceMap: plugin.instanceMap } : {}),
    hasPreScript: plugin.preScript !== undefined,
    tools: plugin.tools.map(t => ({
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      ...(t.summary ? { summary: t.summary } : {}),
      icon: t.icon,
      ...(t.iconSvg ? { iconSvg: t.iconSvg } : {}),
      ...(t.iconInactiveSvg ? { iconInactiveSvg: t.iconInactiveSvg } : {}),
      ...(t.group ? { group: t.group } : {}),
      permission: getConfiguredToolPermission(state, plugin.name, t.name),
    })),
  };
};

// --- Tab handlers ---

/** Wire shape for a single tab info entry — all fields may be absent or wrong type */
interface WirePluginTabInfo {
  tabId?: number;
  url?: string;
  title?: string;
  ready?: boolean;
}

/** Wire shape for tab mapping entries — all fields may be absent or wrong type */
interface WireTabMapping {
  state?: string;
  tabs?: WirePluginTabInfo[];
}

/** Parse a single wire tab info entry into a validated PluginTabInfo */
const parsePluginTabInfo = (wire: WirePluginTabInfo): PluginTabInfo | null => {
  if (typeof wire.tabId !== 'number') return null;
  return {
    tabId: wire.tabId,
    url: typeof wire.url === 'string' ? wire.url : '',
    title: typeof wire.title === 'string' ? wire.title : '',
    ready: wire.ready === true,
  };
};

const parseTabMapping = (wire: WireTabMapping): TabMapping => {
  const state =
    wire.state === 'closed' || wire.state === 'unavailable' || wire.state === 'ready' ? wire.state : 'closed';
  const tabs: PluginTabInfo[] = [];
  if (Array.isArray(wire.tabs)) {
    for (const raw of wire.tabs) {
      const parsed = parsePluginTabInfo(raw);
      if (parsed) tabs.push(parsed);
    }
  }
  return { state, tabs };
};

const handleTabSyncAll = (params: Record<string, unknown> | undefined, senderConn?: ExtensionConnection): void => {
  if (!params || !senderConn) return;
  const tabSyncParams = params as Partial<TabSyncAllParams>;
  const tabs = tabSyncParams.tabs;
  if (!tabs) return;

  senderConn.tabMapping.clear();
  for (const [pluginName, mapping] of Object.entries(tabs)) {
    senderConn.tabMapping.set(pluginName, parseTabMapping(mapping as WireTabMapping));
  }

  // Remove activeNetworkCaptures entries for tabs that are no longer present after the sync
  const syncedTabIds = new Set<number>();
  for (const mapping of senderConn.tabMapping.values()) {
    for (const tab of mapping.tabs) {
      syncedTabIds.add(tab.tabId);
    }
  }
  for (const tabId of senderConn.activeNetworkCaptures) {
    if (!syncedTabIds.has(tabId)) {
      senderConn.activeNetworkCaptures.delete(tabId);
    }
  }

  log.info(
    `tab.syncAll received [${senderConn.profileLabel}]: ${senderConn.tabMapping.size} plugin(s) mapped (connection: ${senderConn.connectionId})`,
  );
};

const handleTabStateChanged = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id?: string | number,
  senderConn?: ExtensionConnection,
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

  if (!senderConn) return;

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
    tabs: Array.isArray(params.tabs) ? (params.tabs as WirePluginTabInfo[]) : [],
  };

  const oldMapping = senderConn.tabMapping.get(plugin);
  const oldTabIds = new Set(oldMapping?.tabs.map((t: { tabId: number }) => t.tabId) ?? []);
  const newMapping = parseTabMapping(wire);
  senderConn.tabMapping.set(plugin, newMapping);
  const newTabIdSet = new Set(newMapping.tabs.map(t => t.tabId));

  // Remove activeNetworkCaptures entries for tabs removed from this plugin's mapping
  for (const tabId of oldTabIds) {
    if (!newTabIdSet.has(tabId)) {
      senderConn.activeNetworkCaptures.delete(tabId);
    }
  }

  log.info(`tab.stateChanged: ${plugin} → ${params.state} [${senderConn.profileLabel}]`);
};

// --- Config handlers ---

/**
 * Build the full ConfigStateResult payload from current server state.
 * Shared between config.getState responses and plugins.changed notifications.
 */
const buildConfigStatePayload = (state: ServerState): ConfigStateResult => {
  const outdatedByPkg = new Map(
    state.outdatedPlugins.map(o => [o.name, { latestVersion: o.latestVersion, updateCommand: o.updateCommand }]),
  );

  const mergedTabs = getMergedTabMapping(state);
  const plugins = Array.from(state.registry.plugins.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => {
      const tabInfo = mergedTabs.get(p.name);
      const update = p.npmPackageName ? outdatedByPkg.get(p.npmPackageName) : undefined;
      const userSettings = state.pluginSettings[p.name];
      const { resolvedValues } = resolvePluginSettings(p.name, p.urlPatterns, p.homepage, p.configSchema, userSettings);
      const hasResolvedSettings = Object.keys(resolvedValues).length > 0;
      return {
        ...serializePluginForExtension(state, p),
        source: p.source,
        tabState: tabInfo?.state ?? 'closed',
        ...(p.sdkVersion ? { sdkVersion: p.sdkVersion } : {}),
        ...(update ? { update } : {}),
        ...(p.configSchema ? { configSchema: p.configSchema } : {}),
        ...(hasResolvedSettings ? { resolvedSettings: resolvedValues } : {}),
      };
    });

  const browserTools = state.cachedBrowserTools
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(ct => ({
      name: ct.name,
      description: ct.description,
      ...(ct.summary ? { summary: ct.summary } : {}),
      permission: getConfiguredToolPermission(state, 'browser', ct.name),
      ...(ct.icon ? { icon: ct.icon } : {}),
      ...(ct.group ? { group: ct.group } : {}),
    }));

  const browserPermission = state.pluginPermissions.browser?.permission ?? 'off';

  let extensionHash: string | undefined;
  try {
    const hashPath = join(getExtensionDir(), '.extension-hash');
    extensionHash = readFileSync(hashPath, 'utf-8').trim() || undefined;
  } catch {
    // Hash file not present — skip
  }

  return {
    plugins,
    failedPlugins: state.discoveryErrors.map(e => ({
      specifier: e.specifier,
      error: e.error,
    })),
    browserTools,
    browserPermission,
    serverVersion: version,
    serverSourcePath,
    skipPermissions: state.skipPermissions,
    extensionHash,
    ...(state.serverUpdate ? { serverUpdate: state.serverUpdate } : {}),
  };
};

const handleConfigGetState = (state: ServerState, id: string | number): void => {
  sendToExtension(state, {
    jsonrpc: '2.0',
    result: buildConfigStatePayload(state),
    id,
  });
};

/**
 * Handle config.setToolPermission: set a per-tool permission override.
 * Works for both plugin tools (plugin=pluginName) and browser tools (plugin='browser').
 */
const handleConfigSetToolPermission = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): void => {
  if (!params) {
    sendJsonRpcError(state, id, -32602, 'Missing params');
    return;
  }

  const toolPermissionParams = params as Partial<ConfigSetToolPermissionParams>;
  const pluginName = toolPermissionParams.plugin;
  const tool = toolPermissionParams.tool;
  const permission = toolPermissionParams.permission;

  if (typeof pluginName !== 'string' || typeof tool !== 'string' || typeof permission !== 'string') {
    sendJsonRpcError(state, id, -32602, 'Invalid params: expected plugin (string), tool (string), permission (string)');
    return;
  }

  if (!VALID_PERMISSIONS.has(permission)) {
    sendJsonRpcError(state, id, -32602, `Invalid permission: ${permission} (expected off, ask, or auto)`);
    return;
  }

  // Validate tool exists in the appropriate context
  if (pluginName === 'browser') {
    if (!state.cachedBrowserTools.some(c => c.name === tool)) {
      sendJsonRpcError(state, id, -32602, `Browser tool not found: ${tool}`);
      return;
    }
  } else {
    const plugin = state.registry.plugins.get(pluginName);
    if (!plugin) {
      sendJsonRpcError(state, id, -32602, `Plugin not found: ${pluginName}`);
      return;
    }
    if (!plugin.tools.some(t => t.name === tool)) {
      sendJsonRpcError(state, id, -32602, `Tool not found: ${tool} in plugin ${pluginName}`);
      return;
    }
  }

  const pConfig = state.pluginPermissions[pluginName] ?? {};
  const pluginDefault: ToolPermission = pConfig.permission ?? 'off';
  const tools = { ...(pConfig.tools ?? {}) };

  if (permission === pluginDefault) {
    delete tools[tool];
  } else {
    tools[tool] = permission as ToolPermission;
  }

  const updated = { ...pConfig };
  if (Object.keys(tools).length > 0) {
    updated.tools = tools;
  } else {
    delete updated.tools;
  }
  state.pluginPermissions[pluginName] = updated;
  callbacks.onToolConfigChanged();
  callbacks.onPluginPermissionsPersist();

  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

  sendToExtension(state, {
    jsonrpc: '2.0',
    result: { ok: true },
    id,
  });
};

/**
 * Handle config.setPluginPermission: set the plugin-level default permission.
 * Works for both plugins (plugin=pluginName) and browser tools (plugin='browser').
 */
const handleConfigSetPluginPermission = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): void => {
  if (!params) {
    sendJsonRpcError(state, id, -32602, 'Missing params');
    return;
  }

  const allToolsPermissionParams = params as Partial<ConfigSetPluginPermissionParams>;
  const pluginName = allToolsPermissionParams.plugin;
  const permission = allToolsPermissionParams.permission;
  const reviewedVersion = allToolsPermissionParams.reviewedVersion;

  if (typeof pluginName !== 'string' || typeof permission !== 'string') {
    sendJsonRpcError(state, id, -32602, 'Invalid params: expected plugin (string), permission (string)');
    return;
  }

  if (!VALID_PERMISSIONS.has(permission)) {
    sendJsonRpcError(state, id, -32602, `Invalid permission: ${permission} (expected off, ask, or auto)`);
    return;
  }

  // Validate plugin exists (browser is always valid)
  if (pluginName !== 'browser') {
    const plugin = state.registry.plugins.get(pluginName);
    if (!plugin) {
      sendJsonRpcError(state, id, -32602, `Plugin not found: ${pluginName}`);
      return;
    }
  }

  const pConfig = state.pluginPermissions[pluginName] ?? {};
  // Clear per-tool overrides: changing the plugin-level permission sets all tools to
  // the new default. Stale overrides would otherwise take precedence in resolution.
  const { tools: _cleared, ...rest } = pConfig;
  state.pluginPermissions[pluginName] = {
    ...rest,
    permission: permission as ToolPermission,
    ...(typeof reviewedVersion === 'string' ? { reviewedVersion } : {}),
  };
  callbacks.onToolConfigChanged();
  callbacks.onPluginPermissionsPersist();

  trackEvent('permission_changed', {
    session_id: getSessionId(),
    target: pluginName === 'browser' ? 'browser' : 'plugin',
    new_permission: permission,
  });

  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

  sendToExtension(state, {
    jsonrpc: '2.0',
    result: { ok: true },
    id,
  });
};

/**
 * Handle config.setSkipPermissions: set the runtime skipPermissions flag.
 * Allows the extension to disable skip-permissions mode at runtime
 * (e.g., when the user clicks "Restore approvals" in the side panel).
 */
const handleConfigSetSkipPermissions = (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): void => {
  if (!params) {
    sendJsonRpcError(state, id, -32602, 'Missing params');
    return;
  }

  const skipPermissions = params.skipPermissions;
  if (typeof skipPermissions !== 'boolean') {
    sendJsonRpcError(state, id, -32602, 'skipPermissions must be a boolean');
    return;
  }

  state.skipPermissions = skipPermissions;

  trackEvent('skip_permissions_changed', {
    session_id: getSessionId(),
    enabled: skipPermissions,
  });

  // Notify the dev proxy so it can pass the updated value to the next worker.
  if (process.env.OPENTABS_PROXY === '1' && process.send) {
    try {
      process.send({ type: 'skipPermissions', value: skipPermissions });
    } catch {
      // Fire-and-forget — IPC errors are silently ignored.
    }
  }

  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

  callbacks.onToolConfigChanged();

  sendToExtension(state, {
    jsonrpc: '2.0',
    result: { ok: true },
    id,
  });
};

/**
 * Handle config.setPluginSettings: save user-provided settings for a plugin.
 * Validates values against the plugin's configSchema (type checking, required fields).
 * After persisting, triggers a reload so URL patterns are re-derived from url-type settings.
 */
const handleConfigSetPluginSettings = async (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): Promise<void> => {
  if (!params) {
    sendJsonRpcError(state, id, -32602, 'Missing params');
    return;
  }

  const pluginName = params.plugin;
  const settings = params.settings;

  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    sendJsonRpcError(state, id, -32602, 'Invalid params: plugin must be a non-empty string');
    return;
  }

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    sendJsonRpcError(state, id, -32602, 'Invalid params: settings must be an object');
    return;
  }

  const settingsObj = settings as Record<string, unknown>;

  // Validate settings against the plugin's configSchema if the plugin is loaded
  const plugin = state.registry.plugins.get(pluginName);
  if (plugin?.configSchema) {
    const schema = plugin.configSchema;
    const errors: string[] = [];

    for (const [key, definition] of Object.entries(schema)) {
      const value = settingsObj[key];

      // Check required fields
      if (definition.required && (value === undefined || value === null || value === '')) {
        errors.push(`Setting "${key}" is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      // Type-check against schema
      switch (definition.type) {
        case 'url': {
          if (typeof value !== 'object' || Array.isArray(value)) {
            errors.push(`Setting "${key}" must be a Record<string, string> (instance name → URL map)`);
            break;
          }
          const urlMap = value as Record<string, unknown>;
          if (Object.keys(urlMap).length === 0) {
            errors.push(`Setting "${key}" must be a non-empty Record<string, string>`);
            break;
          }
          for (const [instanceName, url] of Object.entries(urlMap)) {
            if (instanceName.length === 0) {
              errors.push(`Setting "${key}": instance name must be a non-empty string`);
            } else if (typeof url !== 'string' || url.length === 0) {
              errors.push(`Setting "${key}" instance "${instanceName}": URL must be a non-empty string`);
            } else {
              try {
                new URL(url);
              } catch {
                errors.push(`Setting "${key}" instance "${instanceName}": invalid URL "${url}"`);
              }
            }
          }
          break;
        }
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`Setting "${key}" must be a string`);
          }
          break;
        case 'number':
          if (typeof value !== 'number') {
            errors.push(`Setting "${key}" must be a number`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`Setting "${key}" must be a boolean`);
          }
          break;
        case 'select':
          if (typeof value !== 'string') {
            errors.push(`Setting "${key}" must be a string`);
          } else if (definition.options && !definition.options.includes(value)) {
            errors.push(`Setting "${key}" must be one of: ${definition.options.join(', ')}`);
          }
          break;
      }
    }

    if (errors.length > 0) {
      sendJsonRpcError(state, id, -32602, `Settings validation failed: ${errors.join('; ')}`);
      return;
    }
  }

  // Store settings in state (lenient — store even if plugin isn't loaded yet)
  state.pluginSettings[pluginName] = settingsObj;
  callbacks.onPluginSettingsPersist();

  // Reload to re-derive URL patterns from url-type settings
  try {
    await callbacks.onReload();
  } catch (err) {
    log.warn('Reload after settings change failed:', err);
  }

  const pluginEntry = state.registry.plugins.get(pluginName);
  const hasRequired = pluginEntry?.configSchema ? Object.values(pluginEntry.configSchema).some(f => f.required) : false;
  trackEvent('plugin_configured', {
    session_id: getSessionId(),
    source: 'side_panel',
    had_required_fields: hasRequired,
  });

  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

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

/**
 * Handle a confirmation.response from the extension.
 * Resolves the pending confirmation promise with the user's decision ('allow' or 'deny').
 */
const handleConfirmationResponse = (state: ServerState, params: Record<string, unknown> | undefined): void => {
  if (!params) return;

  const id = params.id;
  if (typeof id !== 'string') return;

  const decision = params.decision;
  if (decision !== 'allow' && decision !== 'deny') return;

  const pending = state.pendingConfirmations.get(id);
  if (!pending) return;

  const alwaysAllow = params.alwaysAllow === true;

  state.pendingConfirmations.delete(id);
  pending.resolve({ action: decision, alwaysAllow });
};

/**
 * Reject all pending confirmations. Called when the extension disconnects
 * to clean up any confirmation promises that can no longer be fulfilled.
 */
const rejectAllPendingConfirmations = (state: ServerState): void => {
  for (const [id, pending] of state.pendingConfirmations) {
    pending.reject(new Error('Extension disconnected — confirmation cancelled'));
    state.pendingConfirmations.delete(id);
  }
};

// --- Folder open handler ---

const handleFolderOpen = async (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
): Promise<void> => {
  if (!params || typeof params.path !== 'string' || params.path.length === 0) {
    sendJsonRpcError(state, id, -32602, 'Invalid params: path must be a non-empty string');
    return;
  }

  try {
    await open(params.path);
    sendToExtension(state, { jsonrpc: '2.0', result: { ok: true }, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to open folder';
    sendJsonRpcError(state, id, -32603, message);
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
    const resultCount = results.length;
    const result_count_bucket = resultCount === 0 ? '0' : resultCount <= 5 ? '1-5' : '6+';
    trackEvent('plugin_search', {
      session_id: getSessionId(),
      source: 'side_panel',
      result_count_bucket,
    });
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

    trackEvent('plugin_installed', {
      session_id: getSessionId(),
      source: 'side_panel',
    });

    // Notify the side panel so the UI refreshes with the new plugin
    sendToExtension(state, {
      jsonrpc: '2.0',
      method: 'plugins.changed',
      params: { ...buildConfigStatePayload(state) },
    });

    log.info(
      `Plugin "${result.plugin.name}" installed — MCP clients may need to reconnect (/mcp in Claude Code) to see new tools`,
    );

    sendToExtension(state, {
      jsonrpc: '2.0',
      result,
      id,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message.toLowerCase() : '';
    const error_category = errorMsg.includes('timed out')
      ? 'timeout'
      : errorMsg.includes('not a valid opentabs plugin')
        ? 'invalid_plugin'
        : 'npm_failure';
    trackEvent('plugin_install_failed', {
      session_id: getSessionId(),
      source: 'side_panel',
      error_category,
    });
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
    sendToExtension(state, {
      jsonrpc: '2.0',
      method: 'plugins.changed',
      params: { ...buildConfigStatePayload(state) },
    });

    trackEvent('plugin_updated', {
      session_id: getSessionId(),
      source: 'side_panel',
    });

    log.info(
      `Plugin "${result.plugin.name}" updated — MCP clients may need to reconnect (/mcp in Claude Code) to see updated tools`,
    );

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
    const existingPlugin = state.registry.plugins.get(pluginName);
    const pluginSource =
      existingPlugin?.source === 'npm' ? 'npm' : existingPlugin?.source === 'local' ? 'local' : 'unknown';
    const result = await removePlugin(pluginName, state, callbacks.onReload);

    trackEvent('plugin_removed', {
      session_id: getSessionId(),
      source: 'side_panel',
      was_failed: false,
      plugin_source: pluginSource,
    });

    // Send plugin.uninstall as a request (with id) so the extension's wrapAsync
    // handler processes it. Best-effort: ignore timeout/error so removal proceeds.
    await callbacks.queryExtension('plugin.uninstall', { name: pluginName }, 5000).catch(() => {});

    // Notify the side panel so the UI refreshes
    sendToExtension(state, {
      jsonrpc: '2.0',
      method: 'plugins.changed',
      params: { ...buildConfigStatePayload(state) },
    });

    log.info(
      `Plugin "${pluginName}" removed — MCP clients may need to reconnect (/mcp in Claude Code) to see updated tools`,
    );

    sendToExtension(state, {
      jsonrpc: '2.0',
      result,
      id,
    });
  } catch (err) {
    sendPluginManagementError(state, id, err);
  }
};

const handlePluginRemoveBySpecifier = async (
  state: ServerState,
  params: Record<string, unknown> | undefined,
  id: string | number,
  callbacks: McpCallbacks,
): Promise<void> => {
  if (!params || typeof params.specifier !== 'string' || params.specifier.length === 0) {
    sendJsonRpcError(state, id, -32602, 'Invalid params: specifier must be a non-empty string');
    return;
  }

  try {
    await removeFailedPlugin(params.specifier, state, callbacks.onReload);
  } catch (err) {
    sendPluginManagementError(state, id, err);
    return;
  }

  trackEvent('plugin_removed', {
    session_id: getSessionId(),
    source: 'side_panel',
    was_failed: true,
    plugin_source: 'unknown',
  });

  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

  sendToExtension(state, {
    jsonrpc: '2.0',
    result: { ok: true },
    id,
  });
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

// --- Server self-update handler ---

const CLI_PACKAGE_NAME = '@opentabs-dev/cli';

const handleServerSelfUpdate = async (state: ServerState, id: string | number): Promise<void> => {
  if (!state.serverUpdate) {
    sendToExtension(state, { jsonrpc: '2.0', error: { code: -32603, message: 'No server update available' }, id });
    return;
  }

  if (!serverSourcePath.includes('node_modules')) {
    sendToExtension(state, {
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Cannot self-update a dev install — use git pull' },
      id,
    });
    return;
  }

  const { latestVersion } = state.serverUpdate;

  const result = spawnSync('npm', ['install', '-g', `${CLI_PACKAGE_NAME}@${latestVersion}`], {
    stdio: isDev() ? 'inherit' : 'ignore',
    shell: isWindows(),
  });
  if (result.error || (result.status ?? 1) !== 0) {
    sendToExtension(state, {
      jsonrpc: '2.0',
      error: { code: -32603, message: `npm install failed (exit ${result.status ?? 'unknown'})` },
      id,
    });
    return;
  }

  trackEvent('server_update_applied', {
    session_id: getSessionId(),
  });

  sendToExtension(state, {
    jsonrpc: '2.0',
    result: { ok: true, message: `Updated to v${latestVersion}. Restarting...` },
    id,
  });

  if (process.stdout.isTTY) {
    process.stdout.write(`Updated to v${latestVersion}. Server restarted in background mode.\n`);
  }

  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const startArgs = ['start', '--background'];
  if (port !== DEFAULT_PORT) startArgs.push('--port', String(port));

  const child = spawn('opentabs', startArgs, { detached: true, stdio: 'ignore', shell: isWindows() });
  child.unref();

  setTimeout(() => process.exit(0), 200);
};

export type { McpCallbacks, WirePluginTabInfo, WireTabMapping };
export {
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
  handleServerSelfUpdate,
  handleTabStateChanged,
  handleTabSyncAll,
  handleToolProgress,
  parsePluginTabInfo,
  parseTabMapping,
  rejectAllPendingConfirmations,
  sendJsonRpcError,
  sendPluginManagementError,
  sendToConnection,
  sendToExtension,
  serializePluginForExtension,
  VALID_LOG_LEVELS,
};
