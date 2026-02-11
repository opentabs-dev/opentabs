/**
 * OpenTabs MCP Server
 *
 * HTTP server with two transport layers:
 * 1. Streamable HTTP at /mcp — for MCP clients (Claude Code, etc.)
 * 2. WebSocket at /ws — for Chrome extension connection
 * 3. GET /health — health check endpoint
 *
 * Hot reload (bun --hot):
 *   Bun 1.x re-evaluates this module on file change but provides NO dispose API
 *   (neither module.hot nor import.meta.hot). We work around this by stashing
 *   cleanup references on globalThis, which persists across hot reloads.
 *   On every module init we check for a previous instance and tear it down:
 *     - Stop the old HTTP server (frees the port)
 *     - Close the extension WebSocket (extension gets a clean close → reconnects)
 *     - Stop file watchers (prevents duplicates)
 *     - Close MCP transport sessions
 *   This makes hot reload seamless: the extension reconnects within ~1s.
 */

import { Server as McpLowLevelServer } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createState } from "./state.js";
import {
  handleExtensionMessage,
  sendSyncFull,
  sendPluginUpdate,
  type McpCallbacks,
} from "./extension-protocol.js";
import { createMcpServer, notifyToolListChanged } from "./mcp-setup.js";
import { loadConfig, saveConfig } from "./config.js";
import { discoverPlugins } from "./discovery.js";
import { startFileWatching, stopFileWatching } from "./file-watcher.js";
import { checkForUpdates } from "./version-check.js";

// ---------------------------------------------------------------------------
// Hot-reload cleanup: globalThis-based (Bun 1.x has no dispose API)
// ---------------------------------------------------------------------------

/**
 * Shape of the cleanup handle we stash on globalThis between hot reloads.
 * Every field is populated after the server starts. On the NEXT module init
 * we call `cleanup()` before creating the new server instance.
 */
interface HotCleanupHandle {
  server: ReturnType<typeof Bun.serve> | null;
  rawExtensionWs: {
    send: (data: string) => void;
    close: (code?: number, reason?: string) => void;
  } | null;
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
  /** The actual port the previous server was listening on.
   *  Preserved so the new instance can rebind to the same port after
   *  hot reload — critical when PORT=0 (OS-assigned) because the
   *  extension is configured for the original port. */
  actualPort: number;
  cleanup: () => void;
}

// Key on globalThis — a symbol would be ideal but a namespaced string is fine
// for a single-server process.
const HOT_KEY = "__opentabs_hot_cleanup__" as const;

/** Read the previous-instance handle (if any). */
const getPreviousHandle = (): HotCleanupHandle | undefined =>
  (globalThis as Record<string, unknown>)[HOT_KEY] as
    | HotCleanupHandle
    | undefined;

/** Store the current-instance handle for the NEXT hot reload. */
const storeHandle = (handle: HotCleanupHandle): void => {
  (globalThis as Record<string, unknown>)[HOT_KEY] = handle;
};

// If a previous module instance left a handle, read its actual port FIRST
// (before cleanup frees it), then tear it down so the new Bun.serve() can
// bind to the same port.
const prev = getPreviousHandle();
const prevActualPort = prev?.actualPort;

if (prev) {
  console.log("[opentabs] Hot reload detected — cleaning up previous instance...");
  prev.cleanup();
  console.log("[opentabs] Hot reload: previous instance cleaned up");
}

// ---------------------------------------------------------------------------
// Server initialisation
// ---------------------------------------------------------------------------

// Determine the port to listen on:
//   1. If a previous hot-reload handle preserved its port, reuse it so the
//      extension (configured for that port) can reconnect after reload.
//   2. Otherwise, use the PORT env var (0 = OS-assigned, default 9515).
const PORT = prevActualPort ?? (process.env.PORT !== undefined ? Number(process.env.PORT) : 9515);

// --- Server state ---
const state = createState();

// --- Load config from ~/.opentabs/config.json ---
const config = await loadConfig();
state.toolConfig = { ...config.tools };
state.pluginPaths = [...config.plugins];
console.log(
  `[opentabs] Config loaded: ${config.plugins.length} plugin path(s), ${Object.keys(config.tools).length} tool setting(s)`
);

// --- Discover plugins from node_modules and local paths ---
await discoverPlugins(state, state.pluginPaths);

// --- Non-blocking: check npm plugins for updates ---
checkForUpdates(state).catch(() => {});

// --- MCP server (low-level) ---
const mcpServer = createMcpServer(state);

// Notify MCP clients of discovered tools (no-op if none connected yet; matters on hot reload)
notifyToolListChanged(mcpServer);

// --- File watching for local plugins ---
startFileWatching(state, {
  onManifestChanged: () => {
    notifyToolListChanged(mcpServer);
  },
  onIifeChanged: (pluginName, iife) => {
    sendPluginUpdate(state, pluginName, iife);
  },
});

// --- MCP transport sessions ---
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

/** Callbacks for extension protocol → MCP server integration */
const mcpCallbacks: McpCallbacks = {
  onToolConfigChanged: () => {
    notifyToolListChanged(mcpServer);
  },
  onToolConfigPersist: () => {
    // Persist current tool config back to ~/.opentabs/config.json
    saveConfig({ plugins: state.pluginPaths, tools: { ...state.toolConfig } });
  },
};

/** Create a new MCP server instance for a session (shares the same handlers) */
const createSessionMcpServer = (): McpLowLevelServer => {
  return createMcpServer(state);
};

/**
 * Track the raw Bun WebSocket for the extension so we can close it explicitly.
 * `state.extensionWs` is typed as `{ send(data: string): void } | null` which
 * doesn't expose `.close()`. We keep a parallel reference to the raw ws here
 * so that hot-reload cleanup and the replacement logic can force-close it.
 */
let rawExtensionWs: {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
} | null = null;

// --- HTTP + WebSocket server ---
const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // --- WebSocket upgrade for extension ---
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // --- Health endpoint ---
    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({
        status: "ok",
        version: "0.0.1",
        extensionConnected: state.extensionWs !== null,
        mcpClients: transports.size,
        plugins: state.plugins.size,
      });
    }

    // --- MCP Streamable HTTP transport ---
    if (url.pathname === "/mcp") {
      const sessionId = req.headers.get("mcp-session-id");

      if (req.method === "POST") {
        // Existing session
        if (sessionId && transports.has(sessionId)) {
          return transports.get(sessionId)!.handleRequest(req);
        }

        // New session — check if it's an initialize request
        const body = await req.json().catch(() => null);
        if (body && isInitializeRequest(body)) {
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sid) => {
              transports.set(sid, transport);
              console.log(`[opentabs] MCP client connected (session: ${sid})`);
            },
            onsessionclosed: (sid) => {
              transports.delete(sid);
              console.log(`[opentabs] MCP client disconnected (session: ${sid})`);
            },
          });

          transport.onclose = () => {
            if (transport.sessionId) {
              transports.delete(transport.sessionId);
            }
          };

          const sessionServer = createSessionMcpServer();
          await sessionServer.connect(transport);
          return transport.handleRequest(req, { parsedBody: body });
        }

        return Response.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message:
                "Bad Request: missing session or not an initialize request",
            },
            id: null,
          },
          { status: 400 }
        );
      }

      if (req.method === "GET") {
        if (sessionId && transports.has(sessionId)) {
          return transports.get(sessionId)!.handleRequest(req);
        }
        return new Response("Missing or invalid session", { status: 400 });
      }

      if (req.method === "DELETE") {
        if (sessionId && transports.has(sessionId)) {
          return transports.get(sessionId)!.handleRequest(req);
        }
        return new Response("Missing or invalid session", { status: 400 });
      }

      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("OpenTabs MCP Server", { status: 200 });
  },
  websocket: {
    open(ws) {
      // Close old extension connection if one exists — prevents zombie connections.
      // The old extension will receive a close event and immediately reconnect.
      if (rawExtensionWs && rawExtensionWs !== ws) {
        console.log(
          "[opentabs] Closing previous extension WebSocket (replaced by new connection)"
        );
        try {
          rawExtensionWs.close(1000, "Replaced by new connection");
        } catch {
          // Already closed — ignore
        }
      }

      console.log("[opentabs] Extension WebSocket connected");
      rawExtensionWs = ws;
      state.extensionWs = ws;

      // Send sync.full with all current plugins
      sendSyncFull(state);
    },
    message(ws, message) {
      const text =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);
      handleExtensionMessage(state, text, mcpCallbacks, ws);
    },
    close(ws) {
      console.log("[opentabs] Extension WebSocket disconnected");
      // Only null out if this is still the current extension connection
      if (rawExtensionWs === ws) {
        rawExtensionWs = null;
      }
      if (state.extensionWs === ws) {
        state.extensionWs = null;
      }
    },
  },
});

console.log(
  `[opentabs] MCP server listening on http://localhost:${server.port}`
);

// ---------------------------------------------------------------------------
// Store cleanup handle for the NEXT hot reload
// ---------------------------------------------------------------------------
// This runs every time the module is evaluated. On the next `bun --hot`
// reload, the new instance reads this handle via getPreviousHandle() at the
// top of the file and tears everything down before creating its own server.

storeHandle({
  server,
  rawExtensionWs,
  transports,
  actualPort: server.port as number,
  cleanup() {
    // 1. Stop file watchers (they hold references to state)
    stopFileWatching();

    // 2. Close the extension WebSocket so the extension gets a clean close
    //    event and reconnects immediately to the new server instance.
    //    We read rawExtensionWs from the closure's outer scope so we always
    //    get the latest value (it's mutated by the ws open/close handlers).
    if (rawExtensionWs) {
      try {
        rawExtensionWs.close(1000, "Server hot reload");
      } catch {
        // Already closed
      }
    }
    // Also null out state so nothing tries to send on a dead socket.
    state.extensionWs = null;

    // 3. Close MCP transport sessions
    for (const transport of transports.values()) {
      transport.close().catch(() => {});
    }
    transports.clear();

    // 4. Stop the HTTP server (frees the port for the new instance)
    server.stop();
  },
});
