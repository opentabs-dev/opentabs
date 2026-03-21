/**
 * HTTP and WebSocket route handlers.
 *
 * Extracted from index.ts so that the entry point is a thin frozen shell
 * (server delegate, HotState management, reload orchestration) while
 * all routing logic lives here and hot-reloads freely.
 *
 * Includes sweepStaleSessions() to prevent memory leaks in the sessionServers
 * array. If an MCP client drops the TCP connection without a proper close
 * (network partition, OOM kill), the onsessionclosed / transport.onclose
 * callbacks may never fire, leaving ghost entries. The sweep runs on each
 * hot reload and removes entries whose transport is no longer in the map.
 */

import { timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { WsHandle } from '@opentabs-dev/shared';
import { toErrorMessage } from '@opentabs-dev/shared';
import { savePluginPermissions, savePluginSettings } from './config.js';
import { isDev } from './dev-mode.js';
import { buildConfigStatePayload, sendToExtension } from './extension-handlers.js';
import type { McpCallbacks } from './extension-protocol.js';
import {
  handleExtensionMessage,
  queryExtension,
  rejectAllPendingConfirmations,
  sendExtensionReload,
  sendSyncFull,
} from './extension-protocol.js';
import { getLogCount } from './log-buffer.js';
import { log } from './logger.js';
import { createGatewayMcpServer } from './mcp-gateway.js';
import type { McpServerInstance } from './mcp-setup.js';
import {
  checkToolCallable,
  createMcpServer,
  getAllToolsList,
  notifyToolListChanged,
  PLATFORM_TOOL_NAMES,
} from './mcp-setup.js';
import type { DispatchCallbacks, RequestHandlerExtra } from './mcp-tool-dispatch.js';
import {
  handleBrowserToolCall,
  handlePluginInspect,
  handlePluginMarkReviewed,
  handlePluginToolCall,
} from './mcp-tool-dispatch.js';
import { performConfigReload } from './reload.js';
import { sanitizeErrorMessage } from './sanitize-error.js';
import { sdkVersion } from './sdk-version.js';
import type { AuditEntry, ExtensionConnection, ServerState } from './state.js';
import { getMergedTabMapping, isExtensionConnected, prefixedToolName, STATE_SCHEMA_VERSION } from './state.js';
import { version } from './version.js';

/** Opaque HotState accessor — index.ts injects the getter */
type GetHotState = () => { reloadCount: number; lastReloadTimestamp: number; lastReloadDurationMs: number } | undefined;

/** Dependencies injected by index.ts to avoid circular imports */
interface RouteDeps {
  state: ServerState;
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
  sessionServers: McpServerInstance[];
  gatewayTransports: Map<string, WebStandardStreamableHTTPServerTransport>;
  gatewaySessionServers: McpServerInstance[];
  getHotState: GetHotState;
}

/** Callbacks for extension protocol → MCP server integration */
const createMcpCallbacks = (
  state: ServerState,
  sessionServers: McpServerInstance[],
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
): McpCallbacks => ({
  onToolConfigChanged: () => {
    for (const srv of sessionServers) {
      notifyToolListChanged(srv);
    }
  },
  onPluginPermissionsPersist: () => {
    savePluginPermissions(state, { ...state.pluginPermissions }).catch(() => {
      // Best-effort persistence — errors are non-fatal for in-memory state
    });
  },
  onPluginSettingsPersist: () => {
    savePluginSettings(state, { ...state.pluginSettings }).catch(() => {
      // Best-effort persistence — errors are non-fatal for in-memory state
    });
  },
  onPluginLog: entry => {
    const mcpLevel = entry.level;
    const logger = `plugin:${entry.plugin}`;
    const data = entry.data !== undefined ? `${entry.message} ${JSON.stringify(entry.data)}` : entry.message;

    // Write to console (flows to server.log via start.ts tee pipeline)
    const levelTag = entry.level.toUpperCase();
    const dataStr = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : '';
    console.log(`[plugin:${entry.plugin}] ${entry.ts} ${levelTag} ${entry.message}${dataStr}`);

    for (const srv of sessionServers) {
      srv.sendLoggingMessage({ level: mcpLevel, logger, data }).catch(() => {
        // Best-effort — client may have disconnected
      });
    }
  },
  onReload: () => performConfigReload(state, sessionServers, transports),
  queryExtension: (method, params = {}, timeoutMs) => queryExtension(state, method, params, timeoutMs),
});

/**
 * Constant-time string comparison using crypto.timingSafeEqual.
 * Rejects early on length mismatch (length is not secret — only content is).
 */
const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/**
 * Check Bearer token in the Authorization header against the server's shared secret.
 * Returns a 401 Response if authentication fails, or null if authentication succeeds.
 * When no secret is configured (wsSecret is null), all requests are allowed through.
 * Uses constant-time comparison to prevent timing side-channel attacks.
 */
const checkBearerAuth = (req: Request, wsSecret: string | null): Response | null => {
  if (!wsSecret) return null;
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !constantTimeEqual(token, wsSecret)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
};

/** Allowed hostnames for the Host header (DNS rebinding protection) */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Check whether a Host header value refers to a localhost address.
 * Strips the optional port suffix before comparing against the allowed set.
 * Handles IPv6 bracket notation (e.g., `[::1]:9515`).
 */
const isLocalhostHost = (hostHeader: string): boolean => {
  let hostname: string;
  if (hostHeader.startsWith('[')) {
    // IPv6 bracket notation: [::1] or [::1]:9515
    const closeBracket = hostHeader.indexOf(']');
    if (closeBracket === -1) return false;
    hostname = hostHeader.slice(1, closeBracket);
  } else {
    // IPv4 or hostname: localhost, localhost:9515, 127.0.0.1:9515
    const colonIdx = hostHeader.lastIndexOf(':');
    hostname = colonIdx === -1 ? hostHeader : hostHeader.slice(0, colonIdx);
  }
  return ALLOWED_HOSTS.has(hostname);
};

// --- Rate limiting for administrative endpoints ---
const checkEndpointRateLimit = (state: ServerState, endpoint: string, maxPerMinute: number): boolean => {
  const now = Date.now();
  const timestamps = (state.endpointCallTimestamps.get(endpoint) ?? []).filter(t => now - t < 60_000);
  // Remove stale map entries when all timestamps have expired to prevent unbounded map growth.
  if (timestamps.length === 0) {
    state.endpointCallTimestamps.delete(endpoint);
  }
  if (timestamps.length >= maxPerMinute) {
    // Only persist non-empty arrays; an empty array has already been cleaned up above.
    if (timestamps.length > 0) {
      state.endpointCallTimestamps.set(endpoint, timestamps);
    }
    return false;
  }
  timestamps.push(now);
  state.endpointCallTimestamps.set(endpoint, timestamps);
  return true;
};

/** Compute aggregate audit statistics from the audit log buffer */
const computeAuditSummary = (auditLog: AuditEntry[]) => {
  const totalInvocations = auditLog.length;
  let successCount = 0;
  let failureCount = 0;
  let totalDurationMs = 0;
  let last24hTotal = 0;
  let last24hSuccess = 0;
  let last24hFailure = 0;

  const cutoff = Date.now() - 86_400_000;

  for (const entry of auditLog) {
    if (entry.success) {
      successCount++;
    } else {
      failureCount++;
    }
    totalDurationMs += entry.durationMs;

    if (new Date(entry.timestamp).getTime() >= cutoff) {
      last24hTotal++;
      if (entry.success) {
        last24hSuccess++;
      } else {
        last24hFailure++;
      }
    }
  }

  const avgDurationMs = totalInvocations > 0 ? Math.round((totalDurationMs / totalInvocations) * 10) / 10 : 0;

  return {
    totalInvocations,
    successCount,
    failureCount,
    last24h: {
      total: last24hTotal,
      success: last24hSuccess,
      failure: last24hFailure,
    },
    avgDurationMs,
  };
};

/** Server adapter subset needed by route handlers (Node.js adapter) */
interface ServerAdapter {
  upgrade: (req: Request, opts: { data: unknown; headers?: HeadersInit }) => boolean;
  timeout: (req: Request, seconds: number) => void;
}

// --- Extracted route handlers ---
// Each handles a single route (or route group) and receives only the
// dependencies it needs. The router in createHandleFetch delegates to these.

/** WebSocket upgrade for extension connections (/ws) */
const handleWsUpgrade = (req: Request, server: ServerAdapter, state: ServerState): Response | undefined => {
  // Authenticate WebSocket connections using a shared secret sent via
  // the Sec-WebSocket-Protocol header (not URL query params, which leak
  // into server logs, browser history, and proxy logs).
  // The client sends protocols: ['opentabs', '<secret>', '<connectionId>?'] and the server
  // echoes 'opentabs' as the accepted subprotocol.
  // Uses constant-time comparison to prevent timing side-channel attacks.
  const protocols = req.headers.get('sec-websocket-protocol');
  const parts = protocols?.split(',').map(p => p.trim()) ?? [];

  // Parse connectionId: the third protocol part (after 'opentabs' and the secret).
  // Parts that are 'opentabs' or match the secret are excluded; the remaining part is the connectionId.
  let parsedConnectionId: string | undefined;
  if (state.wsSecret) {
    let secretMatched = false;
    for (const part of parts) {
      if (constantTimeEqual(part, state.wsSecret)) {
        secretMatched = true;
      } else if (part !== 'opentabs' && !parsedConnectionId) {
        parsedConnectionId = part;
      }
    }
    if (!secretMatched) {
      return new Response('Unauthorized', { status: 401 });
    }
  } else {
    for (const part of parts) {
      if (part !== 'opentabs' && !parsedConnectionId) {
        parsedConnectionId = part;
      }
    }
  }

  // Store the parsed connectionId so createHandleWsOpen can retrieve it.
  // Only set when the client explicitly sent one — the open handler generates a fallback UUID otherwise.
  // This distinction lets the open handler detect backwards-compatible single-connection clients.
  state._pendingConnectionId = parsedConnectionId;

  const upgraded = server.upgrade(req, {
    data: undefined,
    headers: state.wsSecret ? { 'sec-websocket-protocol': 'opentabs' } : undefined,
  });
  if (!upgraded) {
    state._pendingConnectionId = undefined;
    return new Response('WebSocket upgrade failed', { status: 400 });
  }
  return undefined;
};

/** WebSocket info endpoint for extension authentication (GET /ws-info) */
const handleWsInfo = (req: Request, url: URL, state: ServerState): Response => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;
  const wsUrl = `ws://${url.host}/ws`;
  return Response.json({ wsUrl });
};

/** Health endpoint (GET /health) */
const handleHealth = async (
  req: Request,
  state: ServerState,
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  getHotState: GetHotState,
): Promise<Response> => {
  const authenticated = checkBearerAuth(req, state.wsSecret) === null;

  if (!authenticated) {
    return Response.json({ status: 'ok' }, { headers: { 'x-opentabs-version': version } });
  }

  const hs = getHotState();

  // Query the extension for live tab state when connected. Falls back to the
  // server's stale tabMapping cache on timeout (1s) or error.
  let liveTabStates: Record<string, { state: string; tabs: unknown[] }> | null = null;
  if (isExtensionConnected(state)) {
    try {
      const result = (await queryExtension(state, 'extension.getTabState', {}, 1000)) as {
        tabStates?: Record<string, { state: string; tabs: unknown[] }>;
      };
      if (result.tabStates && typeof result.tabStates === 'object') {
        liveTabStates = result.tabStates;
      }
    } catch {
      // Timeout or error — fall back to tabMapping cache
    }
  }

  const mergedTabs = getMergedTabMapping(state);
  const pluginDetails = [...state.registry.plugins.values()].map(p => {
    const liveInfo = liveTabStates?.[p.name];
    const tabInfo = liveInfo ?? mergedTabs.get(p.name);
    const userSettings = state.pluginSettings[p.name] ?? {};
    const needsSetup =
      p.configSchema !== undefined &&
      Object.entries(p.configSchema).some(
        ([key, def]) => def.required === true && (userSettings[key] === undefined || userSettings[key] === null),
      );
    return {
      name: p.name,
      displayName: p.displayName,
      toolCount: p.tools.length,
      tools: p.tools.map(t => prefixedToolName(p.name, t.name)),
      tabState: tabInfo?.state ?? 'closed',
      tabs: tabInfo?.tabs ?? [],
      source: p.source,
      sdkVersion: p.sdkVersion ?? null,
      logBufferSize: getLogCount(p.name),
      needsSetup,
      ...(p.configSchema ? { configSchema: p.configSchema } : {}),
      ...(p.iconSvg ? { iconSvg: p.iconSvg } : {}),
    };
  });

  const browserToolCount = state.cachedBrowserTools.length;
  const pluginToolCount = state.registry.toolLookup.size;
  const toolCount = pluginToolCount + browserToolCount;
  const uptimeSeconds = Math.floor((Date.now() - state.startedAt) / 1000);

  const pendingPlugins = state.fileWatching.entries.filter(e => e.pluginName.startsWith('(pending:')).length;
  const watchedPlugins = state.fileWatching.entries.length - pendingPlugins;

  const auditSummary = computeAuditSummary(state.auditLog);

  const browserConfig = state.pluginPermissions.browser;
  const disabledBrowserTools = state.cachedBrowserTools
    .filter(c => (browserConfig?.tools?.[c.name] ?? browserConfig?.permission ?? 'off') === 'off')
    .map(c => c.name);

  const browserToolNames = state.cachedBrowserTools.map(c => c.name);

  return Response.json(
    {
      status: 'ok',
      version,
      sdkVersion,
      mode: isDev() ? 'dev' : 'production',
      extensionConnected: isExtensionConnected(state),
      extensionConnections: state.extensionConnections.size,
      mcpClients: transports.size,
      plugins: state.registry.plugins.size,
      pluginDetails,
      failedPlugins: [...state.registry.failures],
      discoveryErrors: [...state.discoveryErrors],
      toolCount,
      browserToolCount,
      pluginToolCount,
      browserToolNames,
      disabledBrowserTools,
      skipPermissions: state.skipPermissions,
      uptime: uptimeSeconds,
      reloadCount: hs?.reloadCount ?? 0,
      lastReloadTimestamp: hs?.lastReloadTimestamp ?? 0,
      lastReloadDurationMs: hs?.lastReloadDurationMs ?? 0,
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      fileWatcher: {
        watchedPlugins,
        pendingPlugins,
        lastPollAt: state.fileWatching.mtimeLastPollAt,
        pollDetections: state.fileWatching.mtimePollDetections,
      },
      auditSummary,
    },
    { headers: { 'x-opentabs-version': version } },
  );
};

/** Audit log endpoint (GET /audit) */
const handleAudit = (url: URL, state: ServerState, req: Request): Response => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;

  const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.max(1, Math.min(500, Number.isNaN(limitParam) ? 50 : limitParam));
  const pluginFilter = url.searchParams.get('plugin');
  const toolFilter = url.searchParams.get('tool');
  const successParam = url.searchParams.get('success');
  const successFilter = successParam === 'true' ? true : successParam === 'false' ? false : undefined;

  let entries = [...state.auditLog].reverse();
  if (pluginFilter) entries = entries.filter(e => e.plugin === pluginFilter);
  if (toolFilter) entries = entries.filter(e => e.tool === toolFilter);
  if (successFilter !== undefined) entries = entries.filter(e => e.success === successFilter);
  entries = entries.slice(0, limit);

  return Response.json(entries);
};

/** Tool listing endpoint (GET /tools) */
const handleListTools = (req: Request, url: URL, state: ServerState): Response => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;

  const pluginFilter = url.searchParams.get('plugin');
  const allTools = getAllToolsList(state);

  const annotated = allTools.map(t => {
    if (state.cachedBrowserTools.some(bt => bt.name === t.name)) {
      return { ...t, plugin: 'browser' };
    }
    if (PLATFORM_TOOL_NAMES.has(t.name)) {
      return { ...t, plugin: 'platform' };
    }
    const lookup = state.registry.toolLookup.get(t.name);
    return { ...t, plugin: lookup?.pluginName ?? 'unknown' };
  });

  const filtered = pluginFilter ? annotated.filter(t => t.plugin === pluginFilter) : annotated;

  return Response.json(filtered);
};

/** Tool invocation endpoint (POST /tools/:name/call) */
const handleToolCall = async (
  req: Request,
  url: URL,
  state: ServerState,
  sessionServers: McpServerInstance[],
): Promise<Response> => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;
  if (!checkEndpointRateLimit(state, '/tools/call', 30)) {
    return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
  }

  // Extract tool name from URL: /tools/<name>/call
  const match = url.pathname.match(/^\/tools\/([^/]+)\/call$/);
  if (!match) return Response.json({ error: 'Invalid tool call URL' }, { status: 400 });
  const toolName = match[1] as string;

  const body = (await req.json().catch(() => null)) as { arguments?: Record<string, unknown> } | null;
  const args = body?.arguments ?? {};

  // Minimal RequestHandlerExtra for HTTP context (no MCP progress support)
  const extra: RequestHandlerExtra = {
    signal: AbortSignal.timeout(300_000),
    sendNotification: () => Promise.resolve(),
  };

  const callbacks: DispatchCallbacks = {
    onToolConfigChanged: () => {
      for (const srv of sessionServers) notifyToolListChanged(srv);
    },
  };

  // Platform tools: always available, bypass permissions
  if (toolName === 'plugin_inspect') {
    const result = await handlePluginInspect(state, args);
    return Response.json(result);
  }
  if (toolName === 'plugin_mark_reviewed') {
    const result = await handlePluginMarkReviewed(state, args, callbacks);
    return Response.json(result);
  }

  // Browser tools
  const cachedBt = state.cachedBrowserTools.find(c => c.name === toolName);
  if (cachedBt) {
    const result = await handleBrowserToolCall(state, toolName, args, cachedBt, extra, callbacks);
    return Response.json(result, { status: result.isError ? 422 : 200 });
  }

  // Plugin tools
  const callableCheck = checkToolCallable(state, toolName);
  if (!callableCheck.ok) {
    return Response.json({ content: [{ type: 'text', text: callableCheck.error }], isError: true }, { status: 404 });
  }

  const lookup = state.registry.toolLookup.get(toolName);
  if (!lookup) {
    return Response.json(
      { content: [{ type: 'text', text: `Tool ${toolName} not found` }], isError: true },
      { status: 404 },
    );
  }

  const result = await handlePluginToolCall(
    state,
    toolName,
    args,
    callableCheck.pluginName,
    callableCheck.toolName,
    lookup,
    extra,
    callbacks,
  );
  return Response.json(result, { status: result.isError ? 422 : 200 });
};

/** Config/plugin rediscovery endpoint (POST /reload) */
const handleReload = async (
  req: Request,
  state: ServerState,
  sessionServers: McpServerInstance[],
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
): Promise<Response> => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;
  if (!checkEndpointRateLimit(state, '/reload', 10)) {
    return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
  }
  try {
    const result = await performConfigReload(state, sessionServers, transports);
    return Response.json({
      ok: true,
      plugins: result.plugins,
      durationMs: result.durationMs,
    });
  } catch (err) {
    log.error('Config reload failed:', err);
    const rawMsg = toErrorMessage(err);
    return Response.json({ ok: false, error: sanitizeErrorMessage(rawMsg) }, { status: 500 });
  }
};

/** Extension reload endpoint (POST /extension/reload) */
const handleExtensionReload = (req: Request, state: ServerState): Response => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;
  if (!checkEndpointRateLimit(state, '/extension/reload', 10)) {
    return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
  }
  if (!isExtensionConnected(state)) {
    return Response.json({ ok: false, error: 'Extension not connected' }, { status: 503 });
  }
  sendExtensionReload(state);
  return Response.json({ ok: true, message: 'Reload signal sent to extension' });
};

/** Plugin settings endpoint (POST /plugin-settings) — used by the CLI */
const handlePluginSettings = async (
  req: Request,
  state: ServerState,
  sessionServers: McpServerInstance[],
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
): Promise<Response> => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;
  if (!checkEndpointRateLimit(state, '/plugin-settings', 10)) {
    return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
  }

  const body = (await req.json().catch(() => null)) as { plugin?: string; settings?: Record<string, unknown> } | null;
  if (!body || typeof body.plugin !== 'string' || body.plugin.length === 0) {
    return Response.json({ ok: false, error: 'Missing or invalid "plugin" field' }, { status: 400 });
  }
  if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
    return Response.json({ ok: false, error: 'Missing or invalid "settings" field' }, { status: 400 });
  }

  // Validate url-type fields against the plugin's configSchema
  const registeredPlugin = state.registry.plugins.get(body.plugin);
  if (registeredPlugin?.configSchema) {
    const errors: string[] = [];
    for (const [key, definition] of Object.entries(registeredPlugin.configSchema)) {
      if (definition.type !== 'url') continue;
      const value = body.settings[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`Setting "${key}" must be a Record<string, string> (instance name → URL map)`);
        continue;
      }
      const urlMap = value as Record<string, unknown>;
      if (Object.keys(urlMap).length === 0) {
        errors.push(`Setting "${key}" must be a non-empty Record<string, string>`);
        continue;
      }
      for (const [instanceName, url] of Object.entries(urlMap)) {
        if (instanceName.length === 0) {
          errors.push(`Setting "${key}": instance name must be a non-empty string`);
          continue;
        }
        if (typeof url !== 'string' || url.length === 0) {
          errors.push(`Setting "${key}" instance "${instanceName}": URL must be a non-empty string`);
          continue;
        }
        try {
          new URL(url);
        } catch {
          errors.push(`Setting "${key}" instance "${instanceName}": invalid URL "${url}"`);
        }
      }
    }
    if (errors.length > 0) {
      return Response.json({ ok: false, error: errors.join('; ') }, { status: 400 });
    }
  }

  state.pluginSettings[body.plugin] = body.settings;
  savePluginSettings(state, { ...state.pluginSettings }).catch(() => {});

  try {
    await performConfigReload(state, sessionServers, transports);
  } catch (err) {
    log.warn('Reload after settings change failed:', err);
  }

  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

  return Response.json({ ok: true });
};

/** MCP Streamable HTTP transport (/mcp — POST/GET/DELETE) */
const handleMcp = async (
  req: Request,
  server: ServerAdapter,
  state: ServerState,
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  sessionServers: McpServerInstance[],
): Promise<Response> => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;
  // Disable per-connection idle timeout for MCP requests.
  // Tool dispatches can take up to DISPATCH_TIMEOUT_MS (30s) and the
  // Streamable HTTP transport holds the response open until the tool
  // result arrives. The default idle timeout (10s) would close the
  // connection before long-running dispatches complete.
  server.timeout(req, 0);

  const sessionId = req.headers.get('mcp-session-id');

  if (req.method === 'POST') {
    // Existing session
    if (sessionId) {
      const existingTransport = transports.get(sessionId);
      if (existingTransport) {
        return existingTransport.handleRequest(req);
      }
    }

    // New session — rate-limit session creation to prevent resource exhaustion
    if (!checkEndpointRateLimit(state, '/mcp-session-create', 5)) {
      return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
    }

    // Check if it's an initialize request
    const body: unknown = await req.json().catch(() => null);
    if (body && isInitializeRequest(body)) {
      let sessionServer: McpServerInstance | null = null;

      const removeSession = (): void => {
        if (sessionServer) {
          const idx = sessionServers.indexOf(sessionServer);
          if (idx !== -1) sessionServers.splice(idx, 1);
          sessionServer = null;
        }
      };

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport);
          // Track which transport this session is connected to for stale sweep
          if (sessionServer) {
            state.sessionTransportIds.set(sessionServer, sid);
          }
          log.info(`MCP client connected (session: ${sid})`);
        },
        onsessionclosed: (sid: string) => {
          transports.delete(sid);
          removeSession();
          log.info(`MCP client disconnected (session: ${sid})`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
        removeSession();
      };

      try {
        sessionServer = await createMcpServer(state);
        sessionServers.push(sessionServer);
        await sessionServer.connect(transport);
        return await transport.handleRequest(req, { parsedBody: body });
      } catch (err) {
        removeSession();
        throw err;
      }
    }

    return Response.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Bad Request: missing session or not an initialize request',
        },
        id: null,
      },
      { status: 400 },
    );
  }

  if (req.method === 'GET') {
    const getTransport = sessionId ? transports.get(sessionId) : undefined;
    if (getTransport) {
      return getTransport.handleRequest(req);
    }
    return new Response('Missing or invalid session', { status: 400 });
  }

  if (req.method === 'DELETE') {
    const delTransport = sessionId ? transports.get(sessionId) : undefined;
    if (delTransport) {
      return delTransport.handleRequest(req);
    }
    return new Response('Missing or invalid session', { status: 400 });
  }

  return new Response('Method not allowed', { status: 405 });
};

/** MCP Gateway Streamable HTTP transport (/mcp/gateway — POST/GET/DELETE) */
const handleGatewayMcp = async (
  req: Request,
  server: ServerAdapter,
  state: ServerState,
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  sessionServers: McpServerInstance[],
): Promise<Response> => {
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;
  server.timeout(req, 0);

  const sessionId = req.headers.get('mcp-session-id');

  if (req.method === 'POST') {
    if (sessionId) {
      const existingTransport = transports.get(sessionId);
      if (existingTransport) {
        return existingTransport.handleRequest(req);
      }
    }

    if (!checkEndpointRateLimit(state, '/mcp/gateway-session-create', 5)) {
      return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
    }

    const body: unknown = await req.json().catch(() => null);
    if (body && isInitializeRequest(body)) {
      let sessionServer: McpServerInstance | null = null;

      const removeSession = (): void => {
        if (sessionServer) {
          const idx = sessionServers.indexOf(sessionServer);
          if (idx !== -1) sessionServers.splice(idx, 1);
          sessionServer = null;
        }
      };

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport);
          if (sessionServer) {
            state.sessionTransportIds.set(sessionServer, sid);
          }
          log.info(`MCP gateway client connected (session: ${sid})`);
        },
        onsessionclosed: (sid: string) => {
          transports.delete(sid);
          removeSession();
          log.info(`MCP gateway client disconnected (session: ${sid})`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
        removeSession();
      };

      try {
        sessionServer = await createGatewayMcpServer(state);
        sessionServers.push(sessionServer);
        await sessionServer.connect(transport);
        return await transport.handleRequest(req, { parsedBody: body });
      } catch (err) {
        removeSession();
        throw err;
      }
    }

    return Response.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Bad Request: missing session or not an initialize request',
        },
        id: null,
      },
      { status: 400 },
    );
  }

  if (req.method === 'GET') {
    const getTransport = sessionId ? transports.get(sessionId) : undefined;
    if (getTransport) {
      return getTransport.handleRequest(req);
    }
    return new Response('Missing or invalid session', { status: 400 });
  }

  if (req.method === 'DELETE') {
    const delTransport = sessionId ? transports.get(sessionId) : undefined;
    if (delTransport) {
      return delTransport.handleRequest(req);
    }
    return new Response('Missing or invalid session', { status: 400 });
  }

  return new Response('Method not allowed', { status: 405 });
};

/** Dev-only: set outdated plugins for E2E testing (POST /__test/set-outdated) */
const handleTestSetOutdated = async (req: Request, state: ServerState): Promise<Response> => {
  if (!isDev()) return new Response('Not Found', { status: 404 });
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;

  const body = (await req.json()) as { outdatedPlugins?: unknown[] };
  if (!Array.isArray(body.outdatedPlugins)) {
    return Response.json({ ok: false, error: 'Missing outdatedPlugins array' }, { status: 400 });
  }

  state.outdatedPlugins = body.outdatedPlugins as typeof state.outdatedPlugins;

  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

  return Response.json({ ok: true });
};

/**
 * Dev-only: simulate a successful plugin update for E2E testing.
 * Mutates the plugin's version in the registry, clears the matching
 * outdated entry, and sends a `plugins.changed` notification.
 *
 * POST /__test/simulate-update { pluginName: string, newVersion: string }
 */
const handleTestSimulateUpdate = async (req: Request, state: ServerState): Promise<Response> => {
  if (!isDev()) return new Response('Not Found', { status: 404 });
  const authError = checkBearerAuth(req, state.wsSecret);
  if (authError) return authError;

  const body = (await req.json()) as { pluginName?: string; newVersion?: string };
  if (typeof body.pluginName !== 'string' || typeof body.newVersion !== 'string') {
    return Response.json({ ok: false, error: 'Missing pluginName or newVersion' }, { status: 400 });
  }

  const plugin = state.registry.plugins.get(body.pluginName);
  if (!plugin) {
    return Response.json({ ok: false, error: `Plugin "${body.pluginName}" not found` }, { status: 404 });
  }

  // Mutate the version directly (test-only — the registry is normally immutable)
  (plugin as { version: string }).version = body.newVersion;

  // Remove the matching outdated entry by npm package name
  state.outdatedPlugins = state.outdatedPlugins.filter(o => o.name !== plugin.npmPackageName);

  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

  return Response.json({ ok: true });
};

// --- Main router ---

const createHandleFetch =
  ({ state, transports, sessionServers, gatewayTransports, gatewaySessionServers, getHotState }: RouteDeps) =>
  async (req: Request, server: ServerAdapter): Promise<Response | undefined> => {
    const url = new URL(req.url);

    // --- Host header validation (DNS rebinding protection) ---
    // Reject requests with a non-localhost Host header. A DNS rebinding
    // attack re-maps a malicious domain to 127.0.0.1, so the browser sends
    // requests to our loopback server with Host: evil.com. Checking the Host
    // header is the standard mitigation (CVE-2025-66414 class).
    const hostHeader = req.headers.get('Host');
    if (!hostHeader || !isLocalhostHost(hostHeader)) {
      return new Response('Forbidden: invalid Host header', { status: 403 });
    }

    // --- CORS protection ---
    // MCP clients (Claude Code, etc.) don't run in browsers, so legitimate
    // requests never carry an Origin header. Reject requests with an Origin
    // header to prevent DNS rebinding attacks from malicious web pages.
    //
    // Chrome extension requests carry an Origin of `chrome-extension://...`
    // and must be allowed through — the extension's background script
    // fetches /ws-info to obtain the authenticated WebSocket URL.
    const origin = req.headers.get('Origin');
    if (origin && !origin.startsWith('chrome-extension://')) {
      return new Response('Forbidden: browser requests are not allowed', { status: 403 });
    }

    if (url.pathname === '/ws') return handleWsUpgrade(req, server, state);
    if (url.pathname === '/ws-info' && req.method === 'GET') return handleWsInfo(req, url, state);
    if (url.pathname === '/health' && req.method === 'GET') return handleHealth(req, state, transports, getHotState);
    if (url.pathname === '/audit' && req.method === 'GET') return handleAudit(url, state, req);
    if (url.pathname === '/tools' && req.method === 'GET') return handleListTools(req, url, state);
    if (url.pathname.startsWith('/tools/') && url.pathname.endsWith('/call') && req.method === 'POST')
      return handleToolCall(req, url, state, sessionServers);
    if (url.pathname === '/reload' && req.method === 'POST')
      return handleReload(req, state, sessionServers, transports);
    if (url.pathname === '/extension/reload' && req.method === 'POST') return handleExtensionReload(req, state);
    if (url.pathname === '/plugin-settings' && req.method === 'POST')
      return handlePluginSettings(req, state, sessionServers, transports);
    if (url.pathname === '/__test/set-outdated' && req.method === 'POST') return handleTestSetOutdated(req, state);
    if (url.pathname === '/__test/simulate-update' && req.method === 'POST')
      return handleTestSimulateUpdate(req, state);
    if (url.pathname === '/mcp/gateway')
      return handleGatewayMcp(req, server, state, gatewayTransports, gatewaySessionServers);
    if (url.pathname === '/mcp') return handleMcp(req, server, state, transports, sessionServers);

    return new Response('Not Found', { status: 404 });
  };

const createHandleWsOpen =
  (state: ServerState) =>
  (ws: WsHandle): void => {
    // Consume the connectionId set during upgrade, falling back to a random UUID.
    // Track whether the connectionId was explicitly provided by the client (via subprotocol).
    const hasExplicitId = state._pendingConnectionId !== undefined;
    const connectionId = state._pendingConnectionId ?? crypto.randomUUID();
    state._pendingConnectionId = undefined;

    // If a connection with the same connectionId already exists, close the old one (same-profile reconnect)
    const existing = state.extensionConnections.get(connectionId);
    if (existing && existing.ws !== ws) {
      log.info(
        `Closing previous extension WebSocket (replaced by same-profile reconnect, connectionId: ${connectionId})`,
      );
      try {
        existing.ws.close(1000, 'Replaced by same-profile reconnect');
      } catch {
        // Already closed
      }
    }

    // When the connectionId is auto-generated (client did not send one), assume single-connection
    // mode for backwards compatibility: close the existing connection if there is exactly one.
    if (!hasExplicitId && state.extensionConnections.size === 1) {
      const [existingId, existingConn] = state.extensionConnections.entries().next().value as [
        string,
        ExtensionConnection,
      ];
      if (existingConn.ws !== ws) {
        log.info('Closing previous extension WebSocket (replaced by new connection without connectionId)');
        try {
          existingConn.ws.close(1000, 'Replaced by new connection');
        } catch {
          // Already closed
        }
        state.extensionConnections.delete(existingId);
      }
    }

    const conn: ExtensionConnection = {
      ws,
      connectionId,
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set(connectionId, conn);
    log.info(`Extension WebSocket connected (connectionId: ${connectionId})`);

    void sendSyncFull(state)
      .then(() => {
        if (state.pendingExtensionReload) {
          state.pendingExtensionReload = false;
          log.info('Sending deferred extension reload (version was updated while extension was disconnected)');
          setTimeout(() => {
            try {
              sendExtensionReload(state);
            } catch (err) {
              log.warn('Failed to send extension reload signal:', err);
            }
          }, 500);
        }
      })
      .catch((err: unknown) => {
        log.warn('Failed to send sync.full to extension after WebSocket connect:', err);
      });
  };

const createHandleWsMessage =
  (state: ServerState, mcpCallbacks: McpCallbacks) =>
  (ws: WsHandle, message: string | ArrayBuffer | Uint8Array): void => {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    handleExtensionMessage(state, text, mcpCallbacks, ws);
  };

const createHandleWsClose =
  (state: ServerState) =>
  (ws: WsHandle): void => {
    // Find which connection this ws belongs to
    let closedConn: ExtensionConnection | undefined;
    for (const [id, conn] of state.extensionConnections) {
      if (conn.ws === ws) {
        closedConn = conn;
        state.extensionConnections.delete(id);
        break;
      }
    }

    if (closedConn) {
      log.info(`Extension WebSocket disconnected (connectionId: ${closedConn.connectionId})`);

      // Reject pending dispatches sent over this connection.
      // Dispatches with matching connectionId are always rejected.
      // Dispatches without a connectionId (legacy) are rejected only when no connections remain.
      if (state.pendingDispatches.size > 0) {
        const noConnectionsLeft = state.extensionConnections.size === 0;
        let rejectedCount = 0;
        for (const [id, pending] of state.pendingDispatches) {
          const isOwnedByClosedConn = pending.connectionId === closedConn.connectionId;
          const isLegacyDispatch = pending.connectionId === undefined;
          if (isOwnedByClosedConn || (isLegacyDispatch && noConnectionsLeft)) {
            state.pendingDispatches.delete(id);
            clearTimeout(pending.timerId);
            pending.reject(new Error('Extension disconnected'));
            rejectedCount++;
          }
        }
        if (rejectedCount > 0) {
          log.info(`Rejected ${rejectedCount} pending dispatch(es) for connection ${closedConn.connectionId}`);
        }
      }

      // Reject all pending confirmations only if no connections remain
      if (state.extensionConnections.size === 0) {
        rejectAllPendingConfirmations(state);
      }
    } else {
      log.info('Extension WebSocket disconnected (unknown connection)');
    }
  };

/** Hot-reloadable handler functions for the server delegate shell */
interface HotHandlers {
  /** HTTP request handler — all routing logic */
  fetch: (req: Request, server: ServerAdapter) => Promise<Response | undefined>;
  /** Extension WebSocket opened */
  wsOpen: (ws: WsHandle) => void;
  /** Extension WebSocket message received */
  wsMessage: (ws: WsHandle, message: string | ArrayBuffer | Uint8Array) => void;
  /** Extension WebSocket closed */
  wsClose: (ws: WsHandle) => void;
}

/**
 * Create all hot-reloadable handler functions.
 * Called on every module evaluation (first load + hot reloads) to produce
 * fresh closures over the latest module imports.
 */
const createHandlers = (deps: RouteDeps): HotHandlers => {
  const mcpCallbacks = createMcpCallbacks(deps.state, deps.sessionServers, deps.transports);
  return {
    fetch: createHandleFetch(deps),
    wsOpen: createHandleWsOpen(deps.state),
    wsMessage: createHandleWsMessage(deps.state, mcpCallbacks),
    wsClose: createHandleWsClose(deps.state),
  };
};

/**
 * Remove sessionServers entries whose transport is no longer in the transports
 * map. This prevents unbounded growth when MCP clients disconnect ungracefully
 * (network partition, OOM kill) and the onsessionclosed / transport.onclose
 * callbacks never fire.
 *
 * Each session server is tracked in state.sessionTransportIds (a WeakMap keyed
 * by the McpServerInstance) with the transport session ID it was connected to.
 * A session is stale if its transport ID is absent from the active transports
 * map — meaning the transport was cleaned up but the session server was not.
 *
 * Called on each hot reload from reload.ts.
 */
const sweepStaleSessions = (
  state: ServerState,
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  sessionServers: McpServerInstance[],
): number => {
  let swept = 0;

  for (let i = sessionServers.length - 1; i >= 0; i--) {
    const srv = sessionServers[i];
    if (!srv) continue;
    const transportId = state.sessionTransportIds.get(srv);
    // If we have a recorded transport ID and that transport is gone, the session is stale.
    // If there is no recorded transport ID, the session may be in-flight (created but
    // onsessioninitialized hasn't fired yet) — keep it to avoid trimming valid sessions.
    if (transportId !== undefined && !transports.has(transportId)) {
      sessionServers.splice(i, 1);
      swept++;
    }
  }

  if (swept > 0) {
    log.info(`Swept ${swept} stale MCP session(s) (${transports.size} active transport(s) remain)`);
  }

  return swept;
};

export type { HotHandlers, ServerAdapter };
export {
  checkBearerAuth,
  checkEndpointRateLimit,
  constantTimeEqual,
  createHandlers,
  isLocalhostHost,
  sweepStaleSessions,
};
