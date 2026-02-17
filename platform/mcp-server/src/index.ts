/**
 * OpenTabs MCP Server — Entry point and frozen shell.
 *
 * HTTP server with six endpoints:
 * 1. Streamable HTTP at /mcp — for MCP clients (Claude Code, etc.)
 * 2. WebSocket at /ws — for Chrome extension connection
 * 3. GET /ws-info — authenticated WebSocket URL for extension
 * 4. GET /health — health check endpoint
 * 5. POST /reload — trigger config/plugin rediscovery
 * 6. POST /extension/reload — trigger extension reload
 *
 * Hot reload (bun --hot):
 *   Bun 1.x re-evaluates this module on file change but preserves globalThis.
 *   The Bun.serve() instance is created ONCE on first load with pure delegate
 *   handlers — fetch, websocket.open, websocket.message, websocket.close all
 *   read the latest handler functions from getHotState() at call time. This
 *   means ALL handler logic is hot-reloadable: extension protocol, MCP tool
 *   handlers, browser tools, plugin discovery, config — everything except the
 *   Bun.serve() shell itself.
 *
 *   On hot reload, performReload() in reload.ts handles the full sequence:
 *     1. Config is re-loaded from disk
 *     2. Plugins are re-discovered into a new Map, then swapped atomically
 *     3. Browser tools are refreshed from the new module import
 *     4. MCP handler logic is re-registered on ALL existing sessions
 *     5. File watchers are restarted with fresh callbacks
 *     6. Extension gets a sync.full with the latest plugin state
 *     7. All MCP clients receive tools/list_changed notification
 *     8. Stale tabMapping and outdatedPlugins entries are pruned
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ FROZEN CORE — changes here require a full process restart.          │
 * │                                                                     │
 * │ The following are created ONCE on first load and reused across all  │
 * │ hot reloads. Editing them has NO effect until the process restarts: │
 * │   - HotState interface / getHotState / setHotState                  │
 * │   - createHttpServer (Bun.serve() delegate shell)                   │
 * │   - PORT selection logic                                            │
 * │                                                                     │
 * │ Everything else (handlers, reload orchestration, protocol, tools)   │
 * │ is re-evaluated on each hot reload and takes effect immediately.    │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { createHandlers } from './http-routes.js';
import { log } from './logger.js';
import { performReload } from './reload.js';
import { installShutdownHandlers } from './shutdown.js';
import { createState } from './state.js';
import { version } from './version.js';
import type { HotHandlers } from './http-routes.js';
import type { McpServerInstance } from './mcp-setup.js';
import type { ReloadResult } from './reload.js';
import type { ServerState } from './state.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

// =========================================================================
// FROZEN CORE — Bun.serve() delegate shell and globalThis state management
//
// Changes to this section only take effect after a full process restart.
// Hot reload (bun --hot) re-evaluates the module but the Bun.serve()
// instance, HotState shape, and delegate wiring are created once on first
// load and never recreated.
// =========================================================================

/**
 * Persistent state stored on globalThis across hot reloads.
 * On first load, everything is created fresh. On subsequent reloads,
 * the HTTP server, transports, session servers, and ServerState are
 * reused — only the handler functions and plugin data are refreshed.
 */
interface HotState {
  initialized: boolean;
  server: ReturnType<typeof Bun.serve> | null;
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
  sessionServers: McpServerInstance[];
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

// ---------------------------------------------------------------------------
// Reload orchestration — delegates to reload.ts
// ---------------------------------------------------------------------------

const reloadResult: ReloadResult = await performReload(state, sessionServers, transports, isHotReload);

// ---------------------------------------------------------------------------
// Handler functions — created fresh on every module evaluation
//
// These close over the current module's imports AND the shared mutable
// state objects (state, transports, sessionServers). After hot reload,
// fresh handlers are stored on HotState, and the Bun.serve() delegate
// shell reads them via getHotState() at call time.
// ---------------------------------------------------------------------------

const handlers: HotHandlers = createHandlers({
  state,
  transports,
  sessionServers,
  getHotState,
});

// =========================================================================
// FROZEN CORE — HTTP + WebSocket server (created ONCE, reused across reloads)
//
// The Bun.serve() instance is a pure delegate shell. Its fetch and websocket
// handlers read the latest handler functions from getHotState() at call time.
// This makes ALL handler logic hot-reloadable without recreating the server.
//
// Editing createHttpServer or the PORT logic requires a full process restart.
// =========================================================================

const PORT = hotState?.actualPort ?? (Bun.env.PORT !== undefined ? Number(Bun.env.PORT) : 9515);

/** Create a Bun HTTP + WebSocket server (only on first load) */
const createHttpServer = (): ReturnType<typeof Bun.serve> =>
  Bun.serve({
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

// Reuse existing server on hot reload, create new on first load
const server = hotState?.server ?? createHttpServer();
const actualPort = server.port ?? PORT;

if (!isHotReload) {
  log.info(`MCP server v${version} listening on http://localhost:${actualPort}`);
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
