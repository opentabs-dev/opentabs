/**
 * HTTP and WebSocket route handlers.
 *
 * Extracted from index.ts so that the entry point is a thin frozen shell
 * (Bun.serve() delegate, HotState management, reload orchestration) while
 * all routing logic lives here and hot-reloads freely.
 *
 * Includes sweepStaleSessions() to prevent memory leaks in the sessionServers
 * array. If an MCP client drops the TCP connection without a proper close
 * (network partition, OOM kill), the onsessionclosed / transport.onclose
 * callbacks may never fire, leaving ghost entries. The sweep runs on each
 * hot reload and removes entries whose transport is no longer in the map.
 */

import { saveConfig } from './config.js';
import { handleExtensionMessage, sendSyncFull } from './extension-protocol.js';
import { log } from './logger.js';
import { createMcpServer, notifyToolListChanged } from './mcp-setup.js';
import { performConfigReload } from './reload.js';
import { sanitizeErrorMessage } from './sanitize-error.js';
import { getNextRequestId, STATE_SCHEMA_VERSION } from './state.js';
import { version } from './version.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpCallbacks } from './extension-protocol.js';
import type { McpServerInstance } from './mcp-setup.js';
import type { ServerState } from './state.js';
import type { WsHandle } from '@opentabs-dev/shared';

/** Opaque HotState accessor — index.ts injects the getter */
type GetHotState = () => { reloadCount: number; lastReloadTimestamp: number; lastReloadDurationMs: number } | undefined;

/** Dependencies injected by index.ts to avoid circular imports */
interface RouteDeps {
  state: ServerState;
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
  sessionServers: McpServerInstance[];
  getHotState: GetHotState;
}

/** Callbacks for extension protocol → MCP server integration */
const createMcpCallbacks = (state: ServerState, sessionServers: McpServerInstance[]): McpCallbacks => ({
  onToolConfigChanged: () => {
    for (const srv of sessionServers) {
      notifyToolListChanged(srv);
    }
  },
  onToolConfigPersist: () => {
    saveConfig(state, {
      plugins: state.pluginPaths,
      tools: { ...state.toolConfig },
      secret: state.wsSecret ?? undefined,
      npmPlugins: state.npmPlugins.length > 0 ? state.npmPlugins : undefined,
    }).catch(() => {
      // Error already logged by saveConfig
    });
  },
});

/**
 * Check Bearer token in the Authorization header against the server's shared secret.
 * Returns a 401 Response if authentication fails, or null if authentication succeeds.
 * When no secret is configured (wsSecret is null), all requests are allowed through.
 */
const checkBearerAuth = (req: Request, wsSecret: string | null): Response | null => {
  if (!wsSecret) return null;
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token !== wsSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
};

// --- Rate limiting for administrative endpoints ---
const endpointCallTimestamps = new Map<string, number[]>();

const checkEndpointRateLimit = (endpoint: string, maxPerMinute: number): boolean => {
  const now = Date.now();
  const timestamps = (endpointCallTimestamps.get(endpoint) ?? []).filter(t => now - t < 60_000);
  if (timestamps.length >= maxPerMinute) {
    endpointCallTimestamps.set(endpoint, timestamps);
    return false;
  }
  timestamps.push(now);
  endpointCallTimestamps.set(endpoint, timestamps);
  return true;
};

const createHandleFetch =
  ({ state, transports, sessionServers, getHotState }: RouteDeps) =>
  async (
    req: Request,
    bunServer: {
      upgrade: (req: Request, opts: { data: unknown; headers?: HeadersInit }) => boolean;
      timeout: (req: Request, seconds: number) => void;
    },
  ): Promise<Response | undefined> => {
    const url = new URL(req.url);

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

    // --- WebSocket upgrade for extension ---
    if (url.pathname === '/ws') {
      // Authenticate WebSocket connections using a shared secret sent via
      // the Sec-WebSocket-Protocol header (not URL query params, which leak
      // into server logs, browser history, and proxy logs).
      // The client sends protocols: ['opentabs', '<secret>'] and the server
      // echoes 'opentabs' as the accepted subprotocol.
      if (state.wsSecret) {
        const protocols = req.headers.get('sec-websocket-protocol');
        const parts = protocols?.split(',').map(p => p.trim()) ?? [];
        if (!parts.includes(state.wsSecret)) {
          return new Response('Unauthorized', { status: 401 });
        }
        const upgraded = bunServer.upgrade(req, {
          data: undefined,
          headers: { 'sec-websocket-protocol': 'opentabs' },
        });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }
      const upgraded = bunServer.upgrade(req, { data: undefined });
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return undefined;
    }

    // --- WebSocket info endpoint (for extension authentication) ---
    // Returns the WebSocket URL and secret as separate fields. The secret
    // is sent via the Sec-WebSocket-Protocol header during the upgrade,
    // keeping it out of URLs, logs, and browser history.
    //
    // Protected by Bearer auth when possible, with rate limiting as a fallback.
    // The extension needs /ws-info to bootstrap (get the secret for the first
    // time before it can provide Bearer auth). Rate limiting (10 req/min)
    // prevents brute-force polling by other local processes while allowing
    // normal extension reconnection with exponential backoff. The existing
    // CORS check (above) already blocks all non-extension browser origins.
    if (url.pathname === '/ws-info' && req.method === 'GET') {
      const authError = checkBearerAuth(req, state.wsSecret);
      if (authError) {
        if (!checkEndpointRateLimit('/ws-info', 10)) {
          return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
        }
      }
      const wsUrl = `ws://${url.host}/ws`;
      return Response.json({
        wsUrl,
        ...(state.wsSecret ? { wsSecret: state.wsSecret } : {}),
      });
    }

    // --- Health endpoint ---
    if (url.pathname === '/health' && req.method === 'GET') {
      const hs = getHotState();

      const pluginDetails = [...state.plugins.values()].map(p => ({
        name: p.name,
        displayName: p.displayName ?? p.name,
        toolCount: p.tools.length,
        tabState: state.tabMapping.get(p.name)?.state ?? 'closed',
      }));

      const toolCount = state.toolLookup.size + state.cachedBrowserTools.length;
      const uptimeSeconds = Math.floor((Date.now() - state.startedAt) / 1000);

      return Response.json({
        status: 'ok',
        version,
        extensionConnected: state.extensionWs !== null,
        mcpClients: transports.size,
        plugins: state.plugins.size,
        pluginDetails,
        toolCount,
        uptime: uptimeSeconds,
        reloadCount: hs?.reloadCount ?? 0,
        lastReloadTimestamp: hs?.lastReloadTimestamp ?? 0,
        lastReloadDurationMs: hs?.lastReloadDurationMs ?? 0,
        stateSchemaVersion: STATE_SCHEMA_VERSION,
      });
    }

    // --- Config/plugin rediscovery endpoint ---
    if (url.pathname === '/reload' && req.method === 'POST') {
      const authError = checkBearerAuth(req, state.wsSecret);
      if (authError) return authError;
      if (!checkEndpointRateLimit('/reload', 10)) {
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
        const rawMsg = err instanceof Error ? err.message : String(err);
        return Response.json({ ok: false, error: sanitizeErrorMessage(rawMsg) }, { status: 500 });
      }
    }

    // --- Extension reload endpoint ---
    if (url.pathname === '/extension/reload' && req.method === 'POST') {
      const authError = checkBearerAuth(req, state.wsSecret);
      if (authError) return authError;
      if (!checkEndpointRateLimit('/extension/reload', 10)) {
        return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
      }
      if (!state.extensionWs) {
        return Response.json({ ok: false, error: 'Extension not connected' }, { status: 503 });
      }
      const id = getNextRequestId(state);
      state.extensionWs.send(JSON.stringify({ jsonrpc: '2.0', method: 'extension.reload', id }));
      return Response.json({ ok: true, message: 'Reload signal sent to extension' });
    }

    // --- MCP Streamable HTTP transport ---
    if (url.pathname === '/mcp') {
      const authError = checkBearerAuth(req, state.wsSecret);
      if (authError) return authError;
      // Disable Bun's per-connection idle timeout for MCP requests.
      // Tool dispatches can take up to DISPATCH_TIMEOUT_MS (30s) and the
      // Streamable HTTP transport holds the response open until the tool
      // result arrives. The default idle timeout (10s) would close the
      // connection before long-running dispatches complete.
      bunServer.timeout(req, 0);

      const sessionId = req.headers.get('mcp-session-id');

      if (req.method === 'POST') {
        // Existing session
        if (sessionId) {
          const existingTransport = transports.get(sessionId);
          if (existingTransport) {
            return existingTransport.handleRequest(req);
          }
        }

        // New session — check if it's an initialize request
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

          sessionServer = await createMcpServer(state);
          sessionServers.push(sessionServer);
          await sessionServer.connect(transport);
          return transport.handleRequest(req, { parsedBody: body });
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
    }

    return new Response('Not Found', { status: 404 });
  };

const createHandleWsOpen =
  (state: ServerState) =>
  (ws: WsHandle): void => {
    const previousWs = state.extensionWs;

    // Assign the new WS BEFORE closing the previous one. Bun fires the
    // close handler synchronously during ws.close(), so if extensionWs
    // still pointed at the old WS the close handler would see
    // `state.extensionWs === ws` (true) and reject all pending dispatches
    // with "Extension disconnected" — even though a new connection is
    // already taking over.
    log.info('Extension WebSocket connected');
    state.extensionWs = ws;

    if (previousWs && previousWs !== ws) {
      log.info('Closing previous extension WebSocket (replaced by new connection)');
      try {
        previousWs.close(1000, 'Replaced by new connection');
      } catch {
        // Already closed
      }
    }

    void sendSyncFull(state);
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
    log.info('Extension WebSocket disconnected');
    if (state.extensionWs === ws) {
      state.extensionWs = null;

      // Reject all pending dispatches immediately so MCP clients get a fast
      // error instead of hanging until the 30-second dispatch timeout fires.
      if (state.pendingDispatches.size > 0) {
        log.info(`Rejecting ${state.pendingDispatches.size} pending dispatch(es) due to extension disconnect`);
        for (const [id, pending] of state.pendingDispatches) {
          state.pendingDispatches.delete(id);
          clearTimeout(pending.timerId);
          pending.reject(new Error('Extension disconnected'));
        }
      }
    }
  };

/** Hot-reloadable handler functions for the Bun.serve() delegate shell */
interface HotHandlers {
  /** HTTP request handler — all routing logic */
  fetch: (
    req: Request,
    bunServer: {
      upgrade: (req: Request, opts: { data: unknown; headers?: HeadersInit }) => boolean;
      timeout: (req: Request, seconds: number) => void;
    },
  ) => Promise<Response | undefined>;
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
  const mcpCallbacks = createMcpCallbacks(deps.state, deps.sessionServers);
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

export type { HotHandlers };
export { checkBearerAuth, createHandlers, sweepStaleSessions };
