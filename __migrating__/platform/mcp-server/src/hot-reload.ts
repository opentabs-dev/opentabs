// Hot reload support for the MCP server
//
// When running with `bun --hot`, all modules are re-evaluated on file change
// but the process and globalThis persist. This module manages state that must
// survive reloads (WebSocket relay, HTTP server, transport maps) and provides
// the mechanism to hot-patch tools on existing MCP sessions.
//
// Flow on hot reload:
// 1. All modules re-evaluate (fresh tool code is loaded)
// 2. globalThis state is preserved (relay, HTTP server, sessions)
// 3. registerAllTools() is called on a temporary McpServer to collect fresh tool definitions
// 4. For each existing session, tools are diffed and updated via RegisteredTool.update()
// 5. The MCP SDK automatically sends `notifications/tools/list_changed` to connected clients
//
// Ported from packages/mcp-server/src/hot-reload.ts — adapted to use local
// type imports instead of @extension/shared. No behavioral changes.

import type { ServerConfig } from './config.js';
import type { WebSocketRelay } from './websocket-relay.js';
import type { McpServer, RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { Server as HttpServer } from 'node:http';

/**
 * Minimal transport interface for hot state storage.
 * Avoids importing concrete transport classes (SSEServerTransport is deprecated).
 * http-server.ts casts to the concrete types where transport-specific methods are needed.
 */
interface TransportHandle {
  close: () => Promise<void>;
}

/**
 * A single MCP client session with its server, transport, and tool registrations.
 * Consolidates what was previously spread across 4+ parallel Maps.
 */
interface SessionEntry {
  /** The MCP server instance for this session */
  server: McpServer;
  /** The transport (SSE or Streamable HTTP) */
  transport: TransportHandle;
  /** Transport type for logging and health reporting */
  type: 'sse' | 'stream';
  /** Registered tool references keyed by tool name */
  tools: Map<string, RegisteredTool>;
}

/**
 * Result of the last hot reload attempt, for health/diagnostics.
 */
interface HotReloadResult {
  /** Whether the last reload succeeded */
  success: boolean;
  /** Timestamp of the last reload */
  timestamp: number;
  /** Number of sessions patched */
  patchedSessions: number;
  /** Number of tools collected */
  toolCount: number;
  /** Error message if the reload failed */
  error?: string;
}

/**
 * State that persists across hot reloads via globalThis.
 *
 * The WebSocket relay, HTTP server, and all client sessions survive
 * module re-evaluation because they are stored here.
 */
interface HotReloadState {
  /** Whether the server has completed initial startup */
  initialized: boolean;
  /** Parsed server configuration (preserved so CLI args aren't re-parsed on reload) */
  config: ServerConfig | null;
  /** The WebSocket relay instance (singleton) */
  relay: WebSocketRelay | null;
  /** The Node.js HTTP server instance */
  httpServer: HttpServer | null;
  /** Factory function for creating new MCP servers (updated on each reload) */
  createServerFn: ((sessionId?: string, transport?: TransportHandle, type?: 'sse' | 'stream') => McpServer) | null;
  /** All active MCP client sessions keyed by session ID */
  sessions: Map<string, SessionEntry>;
  /** Counter for hot reload generations (for logging) */
  reloadCount: number;
  /** Result of the most recent hot reload attempt */
  lastReload: HotReloadResult | null;
}

// Extend globalThis type to include our hot reload state
declare global {
  var __openTabsHotState: HotReloadState | undefined;
}

/**
 * Get or create the hot reload state on globalThis.
 * On first load, creates fresh state. On subsequent hot reloads,
 * returns the existing state with all connections intact.
 */
const getHotState = (): HotReloadState => {
  if (!globalThis.__openTabsHotState) {
    globalThis.__openTabsHotState = {
      initialized: false,
      config: null,
      relay: null,
      httpServer: null,
      createServerFn: null,
      sessions: new Map(),
      reloadCount: 0,
      lastReload: null,
    };
  }
  return globalThis.__openTabsHotState!;
};

/**
 * Check if this is a hot reload (server was previously initialized).
 */
const isHotReload = (): boolean => getHotState().initialized;

/**
 * Register a session in the unified session map.
 * Called when a new MCP client connects (SSE or Streamable HTTP).
 */
const registerSession = (sessionId: string, entry: SessionEntry): void => {
  getHotState().sessions.set(sessionId, entry);
};

/**
 * Remove a session from the unified session map.
 * Called when a client disconnects.
 */
const removeSession = (sessionId: string): void => {
  getHotState().sessions.delete(sessionId);
};

/**
 * Get a session entry by ID.
 */
const getSession = (sessionId: string): SessionEntry | undefined => getHotState().sessions.get(sessionId);

/**
 * Close and remove all sessions, then close the HTTP server.
 * Used for graceful shutdown.
 */
const closeAllSessions = async (): Promise<void> => {
  const state = getHotState();
  for (const [, entry] of state.sessions) {
    await entry.transport.close();
  }
  state.sessions.clear();

  if (state.httpServer) {
    const server = state.httpServer;
    state.httpServer = null;

    await new Promise<void>(resolve => {
      // Stop accepting new connections, then force-close lingering ones.
      // closeAllConnections() ensures keep-alive / SSE connections don't
      // prevent the close callback from firing.
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
};

/**
 * Hot-patch tools on an existing MCP server session.
 *
 * Compares the existing registered tools with the fresh tool definitions:
 * - Removed tools: removed via RegisteredTool.remove()
 * - Changed tools: updated via RegisteredTool.update() with all mutable fields
 * - New tools: registered via registerAllTools() on a wrapper that skips existing tools
 *
 * The MCP SDK sends `notifications/tools/list_changed` on each mutation.
 * With `debouncedNotificationMethods` enabled on the server, all mutations
 * within one event-loop tick are coalesced into a single notification.
 */
const hotPatchSession = (
  entry: SessionEntry,
  sessionId: string,
  freshTools: Map<string, RegisteredTool>,
  registerAllTools: (server: McpServer) => Map<string, RegisteredTool>,
): void => {
  const { server, tools: existingTools } = entry;

  // Bail early if the session has disconnected since we checked
  if (!server.isConnected()) {
    return;
  }

  const existingNames = new Set(existingTools.keys());
  const freshNames = new Set(freshTools.keys());

  // Remove tools that no longer exist
  for (const name of existingNames) {
    if (!freshNames.has(name)) {
      try {
        const tool = existingTools.get(name)!;
        tool.remove();
        existingTools.delete(name);
      } catch (err) {
        console.error(`[MCP] Hot reload: failed to remove tool "${name}" on session ${sessionId.slice(0, 8)}:`, err);
      }
    }
  }

  // Update existing tools with fresh callbacks and all mutable metadata.
  //
  // The SDK's update().paramsSchema expects a ZodRawShapeCompat (raw shape object),
  // but freshTool.inputSchema is already a processed ZodObject. Passing it to
  // update().paramsSchema would double-wrap it via objectFromShape(). Instead, we
  // directly assign inputSchema on the registered tool object (it's a plain mutable
  // property) and use update() for the fields it handles correctly.
  for (const name of existingNames) {
    if (freshNames.has(name)) {
      try {
        const existingTool = existingTools.get(name)!;
        const freshTool = freshTools.get(name)!;

        // Directly assign inputSchema to avoid double-wrapping through objectFromShape()
        existingTool.inputSchema = freshTool.inputSchema;

        existingTool.update({
          title: freshTool.title,
          description: freshTool.description,
          annotations: freshTool.annotations,
          callback: freshTool.handler as ToolCallback<ZodRawShapeCompat>,
        });
      } catch (err) {
        console.error(`[MCP] Hot reload: failed to update tool "${name}" on session ${sessionId.slice(0, 8)}:`, err);
      }
    }
  }

  // Register new tools that didn't exist before
  const newToolNames = [...freshNames].filter(name => !existingNames.has(name));
  if (newToolNames.length > 0) {
    // Re-run registerAllTools on the server. The SDK throws "Tool X is already registered"
    // for existing tools, so we wrap registerTool to skip them.
    const originalRegisterTool = server.registerTool.bind(server);
    const newToolNamesSet = new Set(newToolNames);

    server.registerTool = ((toolName: string, ...args: unknown[]) => {
      if (newToolNamesSet.has(toolName)) {
        try {
          const registered = (originalRegisterTool as (...a: unknown[]) => RegisteredTool)(toolName, ...args);
          existingTools.set(toolName, registered);
          return registered;
        } catch (err) {
          console.error(
            `[MCP] Hot reload: failed to register new tool "${toolName}" on session ${sessionId.slice(0, 8)}:`,
            err,
          );
          // Return a no-op stub to prevent registerAllTools from crashing.
          // The tool is NOT added to existingTools so subsequent reloads
          // will retry registration instead of calling update() on a stub.
          return createStubRegisteredTool();
        }
      }
      // Return the existing reference for already-registered tools
      return existingTools.get(toolName)!;
    }) as typeof server.registerTool;

    try {
      registerAllTools(server);
    } catch (err) {
      console.error(`[MCP] Hot reload: failed to register new tools on session ${sessionId.slice(0, 8)}:`, err);
    } finally {
      // Always restore original method, even if registerAllTools throws
      server.registerTool = originalRegisterTool;
    }
  }
};

/**
 * Create a no-op stub that satisfies the RegisteredTool interface.
 * Used when a tool registration fails during hot reload to prevent
 * crashes in registerAllTools while keeping the tool out of existingTools.
 */
const createStubRegisteredTool = (): RegisteredTool =>
  ({
    enabled: false,
    handler: () => ({ content: [{ type: 'text', text: 'stub' }] }),
    enable: () => {},
    disable: () => {},
    update: () => {},
    remove: () => {},
  }) as unknown as RegisteredTool;

/**
 * Collect fresh tool definitions by registering all tools on a temporary server.
 */
const collectFreshTools = (
  registerAllTools: (server: McpServer) => Map<string, RegisteredTool>,
  McpServerClass: new (info: { name: string; version: string }) => McpServer,
  serverName: string,
  serverVersion: string,
): Map<string, RegisteredTool> => {
  const tempServer = new McpServerClass({ name: serverName, version: serverVersion });
  return registerAllTools(tempServer);
};

/**
 * Hot-patch all existing MCP server sessions with fresh tool definitions.
 *
 * Called on hot reload after new module code is loaded.
 * Skips sessions whose servers are no longer connected (stale sessions
 * from ungraceful disconnects) and cleans them up.
 */
const hotPatchAllSessions = (
  registerAllTools: (server: McpServer) => Map<string, RegisteredTool>,
  McpServerClass: new (info: { name: string; version: string }) => McpServer,
  serverName: string,
  serverVersion: string,
): void => {
  const state = getHotState();

  const freshTools = collectFreshTools(registerAllTools, McpServerClass, serverName, serverVersion);
  console.error(`[MCP] Hot reload #${state.reloadCount}: ${freshTools.size} tools collected`);

  let patchedCount = 0;

  for (const [sessionId, entry] of state.sessions) {
    // Skip and clean up sessions whose server is no longer connected
    if (!entry.server.isConnected()) {
      state.sessions.delete(sessionId);
      continue;
    }

    hotPatchSession(entry, sessionId, freshTools, registerAllTools);
    patchedCount++;
  }

  if (patchedCount > 0) {
    console.error(`[MCP] Hot reload: patched ${patchedCount} active session(s)`);
  }

  state.lastReload = {
    success: true,
    timestamp: Date.now(),
    patchedSessions: patchedCount,
    toolCount: freshTools.size,
  };
};

export { closeAllSessions, getHotState, getSession, hotPatchAllSessions, isHotReload, registerSession, removeSession };
export type { HotReloadResult, HotReloadState, SessionEntry, TransportHandle };
