/**
 * OpenTabs MCP Server — Entry point and frozen shell.
 *
 * HTTP server with six endpoints:
 * 1. Streamable HTTP at /mcp — for MCP clients (Claude Code, etc.)
 * 2. WebSocket at /ws — for Chrome extension connection
 * 3. GET /ws-info — authenticated WebSocket URL for extension
 * 4. GET /health — health check endpoint (includes mode: 'dev' | 'production')
 * 5. POST /reload — trigger config/plugin rediscovery
 * 6. POST /extension/reload — trigger extension reload
 *
 * Uses node:http + ws via server-node.ts. In dev mode, a proxy process wraps
 * this server and restarts the worker process on code changes while holding
 * client connections open.
 *
 * On hot reload, performReload() in reload.ts handles the full sequence:
 *   1. Config is re-loaded from disk
 *   2. Plugins are re-discovered into a new Map, then swapped atomically
 *   3. Browser tools are refreshed from the new module import
 *   4. MCP handler logic is re-registered on ALL existing sessions
 *   5. File watchers are restarted with fresh callbacks
 *   6. Extension gets a sync.full with the latest plugin state
 *   7. All MCP clients receive tools/list_changed notification
 *   8. Stale tabMapping and outdatedPlugins entries are pruned
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ FROZEN CORE — changes here require a full process restart.          │
 * │                                                                     │
 * │ The following are created ONCE on first load and reused across all  │
 * │ hot reloads. Editing them has NO effect until the process restarts: │
 * │   - HotState interface / getHotState / setHotState                  │
 * │   - createHttpServer (server delegate shell)                        │
 * │   - PORT selection logic                                            │
 * │                                                                     │
 * │ Everything else (handlers, reload orchestration, protocol, tools)   │
 * │ is re-evaluated on each hot reload and takes effect immediately.    │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { DEFAULT_HOST, DEFAULT_PORT } from '@opentabs-dev/shared';
import { isDev } from './dev-mode.js';
import type { HotHandlers } from './http-routes.js';
import { createHandlers } from './http-routes.js';
import { log } from './logger.js';
import type { McpServerInstance } from './mcp-setup.js';
import type { ReloadResult } from './reload.js';
import { performReload, runVersionCheck } from './reload.js';
import type { NodeServer } from './server-node.js';
import { createNodeServer } from './server-node.js';
import { installShutdownHandlers } from './shutdown.js';
import type { ServerState } from './state.js';
import { createState } from './state.js';
import { getSessionId, identifyPerson, initTelemetry, trackEvent } from './telemetry.js';
import { version } from './version.js';

// =========================================================================
// FROZEN CORE — Server delegate shell and globalThis state management
//
// Changes to this section only take effect after a full process restart.
// The server instance, HotState shape, and delegate wiring are created once
// on first load and never recreated.
// =========================================================================

type ServerInstance = NodeServer;

/**
 * Persistent state stored on globalThis across hot reloads.
 * On first load, everything is created fresh. On subsequent reloads,
 * the HTTP server, transports, session servers, and ServerState are
 * reused — only the handler functions and plugin data are refreshed.
 */
interface HotState {
  initialized: boolean;
  server: ServerInstance | null;
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
  sessionServers: McpServerInstance[];
  gatewayTransports: Map<string, WebStandardStreamableHTTPServerTransport>;
  gatewaySessionServers: McpServerInstance[];
  state: ServerState;
  actualPort: number;
  handlers: HotHandlers;
  /** Number of hot reloads since process start (0 on first load) */
  reloadCount: number;
  /** Timestamp (ms since epoch) of the last completed reload */
  lastReloadTimestamp: number;
  /** Duration (ms) of the last reload sequence */
  lastReloadDurationMs: number;
}

const HOT_KEY = '__opentabs_hot_state__' as const;

const getHotState = (): HotState | undefined =>
  (globalThis as Record<string, unknown>)[HOT_KEY] as HotState | undefined;

const setHotState = (hs: HotState): void => {
  (globalThis as Record<string, unknown>)[HOT_KEY] = hs;
};

// ---------------------------------------------------------------------------
// Determine if this is a hot reload or first load
// ---------------------------------------------------------------------------

const hotState = getHotState();
const isHotReload = hotState?.initialized === true;
const reloadCount = isHotReload ? hotState.reloadCount + 1 : 0;

// ---------------------------------------------------------------------------
// Shared mutable state — the SAME object references across all reloads
// ---------------------------------------------------------------------------

const state: ServerState = hotState?.state ?? createState();

// Patch missing fields from defaults so that newly added ServerState fields
// are present on the persisted state object after hot reload during development.
// Only patches top-level keys — structural type changes to existing fields
// require a process restart (detected by schema version mismatch below).
if (isHotReload) {
  const defaults = createState();

  // Detect structural schema changes that cannot be patched
  if (state._schemaVersion !== defaults._schemaVersion) {
    log.warn(
      `State schema version changed (${state._schemaVersion} → ${defaults._schemaVersion}). Restart the MCP server process for this change to take full effect.`,
    );
    state._schemaVersion = defaults._schemaVersion;
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in state)) {
      (state as unknown as Record<string, unknown>)[key] = value;
    }
  }
}

const transports: Map<string, WebStandardStreamableHTTPServerTransport> =
  hotState?.transports ?? new Map<string, WebStandardStreamableHTTPServerTransport>();
const sessionServers: McpServerInstance[] = hotState?.sessionServers ?? [];
const gatewayTransports: Map<string, WebStandardStreamableHTTPServerTransport> =
  hotState?.gatewayTransports ?? new Map<string, WebStandardStreamableHTTPServerTransport>();
const gatewaySessionServers: McpServerInstance[] = hotState?.gatewaySessionServers ?? [];

// ---------------------------------------------------------------------------
// Telemetry — initialized once on first load (fire-and-forget, non-blocking)
// ---------------------------------------------------------------------------

if (!isHotReload) {
  void initTelemetry();
}

// ---------------------------------------------------------------------------
// Reload orchestration — delegates to reload.ts
// ---------------------------------------------------------------------------

const reloadResult: ReloadResult = await performReload(state, sessionServers, transports, isHotReload);

// Schedule periodic version checks (fire-and-forget, not on the reload path).
// Clear any existing timer from a previous hot reload iteration before setting a new one.
if (state.versionCheckTimerId !== null) {
  clearInterval(state.versionCheckTimerId);
  state.versionCheckTimerId = null;
}
void runVersionCheck(state);
state.versionCheckTimerId = setInterval(() => void runVersionCheck(state), 6 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Handler functions — created fresh on every module evaluation
//
// These close over the current module's imports AND the shared mutable
// state objects (state, transports, sessionServers). After hot reload,
// fresh handlers are stored on HotState, and the server delegate shell
// reads them via getHotState() at call time.
// ---------------------------------------------------------------------------

const handlers: HotHandlers = createHandlers({
  state,
  transports,
  sessionServers,
  gatewayTransports,
  gatewaySessionServers,
  getHotState,
});

// =========================================================================
// FROZEN CORE — HTTP + WebSocket server (created ONCE, reused across reloads)
//
// The server instance is a pure delegate shell. Its fetch and websocket
// handlers read the latest handler functions from getHotState() at call time.
// This makes ALL handler logic hot-reloadable without recreating the server.
//
// Editing createHttpServer or the PORT logic requires a full process restart.
// =========================================================================

/** Parse and validate the PORT from environment or default. Port 0 is valid (OS assigns ephemeral port). */
const resolvePort = (): number => {
  const raw = process.env.PORT;
  if (raw === undefined) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535 || parsed !== Math.floor(parsed)) {
    throw new Error(`Invalid PORT value "${raw}". Must be an integer between 0 and 65535.`);
  }
  return parsed;
};

const PORT = hotState?.actualPort ?? resolvePort();
const HOST = process.env.HOST ?? DEFAULT_HOST;

/** Handle EADDRINUSE errors with a helpful message */
const handleListenError = (error: unknown): never => {
  const isAddrInUse = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
  if (isAddrInUse) {
    log.error(`Port ${PORT} is already in use. Kill the existing process or use a different port:`);
    if (process.platform === 'win32') {
      log.error(`  netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F`);
    } else {
      log.error(`  lsof -ti :${PORT} | xargs kill`);
    }
    log.error(`  PORT=<number> opentabs start`);
  }
  throw error;
};

/** Create the HTTP + WebSocket server */
const createHttpServer = async (): Promise<ServerInstance> => {
  try {
    return await createNodeServer({
      hostname: HOST,
      port: PORT,
      async fetch(req, server) {
        const hs = getHotState();
        if (!hs) return new Response('Server initializing', { status: 503 });
        return hs.handlers.fetch(req, server);
      },
      websocket: {
        open(ws) {
          getHotState()?.handlers.wsOpen(ws);
        },
        message(ws, message) {
          getHotState()?.handlers.wsMessage(ws, message);
        },
        close(ws) {
          getHotState()?.handlers.wsClose(ws);
        },
      },
    });
  } catch (error: unknown) {
    return handleListenError(error);
  }
};

// Reuse existing server on hot reload, create new on first load
const server = hotState?.server ?? (await createHttpServer());
const actualPort = server.port;

if (!isHotReload) {
  const modeLabel = isDev() ? ' (dev mode)' : '';
  log.info(`MCP server v${version} listening on http://${HOST}:${actualPort}${modeLabel}`);

  const plugins = Array.from(state.registry.plugins.values());
  trackEvent('server_started', {
    version,
    os: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    plugins_loaded: state.registry.plugins.size,
    plugins_failed: state.registry.failures.length,
    plugins_local: plugins.filter(p => p.source === 'local').length,
    plugins_npm: plugins.filter(p => p.source === 'npm').length,
    session_id: getSessionId(),
    mode: isDev() ? 'dev' : 'production',
  });

  identifyPerson({
    $set: { version, mode: isDev() ? 'dev' : 'production' },
    $set_once: { os: process.platform, arch: process.arch, node_version: process.version },
  });
}

// When running under the dev proxy (forked with OPENTABS_PROXY=1), report
// the actual listening port so the proxy knows where to forward requests.
if (process.env.OPENTABS_PROXY === '1' && process.send) {
  process.send({ type: 'ready', port: actualPort });
}

// Install graceful shutdown handlers (once per process, survives hot reloads).
// Uses a getter so the handler always operates on the latest state reference.
installShutdownHandlers(() => state);

// ---------------------------------------------------------------------------
// Store hot state for the NEXT hot reload
// ---------------------------------------------------------------------------

setHotState({
  initialized: true,
  server,
  transports,
  sessionServers,
  gatewayTransports,
  gatewaySessionServers,
  state,
  actualPort,
  reloadCount,
  lastReloadTimestamp: reloadResult.lastReloadTimestamp,
  lastReloadDurationMs: reloadResult.lastReloadDurationMs,
  handlers,
});

if (isHotReload) {
  log.info(`Hot reload complete (${reloadResult.lastReloadDurationMs}ms)`);
}
