// MCP Server creation and startup logic
//
// Supports hot reload via bun --hot: on file changes, the process stays alive,
// all modules re-evaluate, and tools are hot-patched on existing MCP sessions.
// Connected clients receive `notifications/tools/list_changed` automatically.

import { getHotState, isHotReload, hotPatchAllSessions, registerSession, closeAllSessions } from './hot-reload.js';
import { startHttpServer } from './http-server.js';
import { registerAllTools } from './tools/index.js';
import { relay } from './websocket-relay.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerConfig } from './config.js';
import type { TransportHandle } from './hot-reload.js';

const SERVER_NAME = 'OpenTabs';

// Read version from package.json at module load time
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
const SERVER_VERSION = packageJson.version;

/**
 * Create and configure the MCP server.
 *
 * Each client session gets its own McpServer instance.
 * When a session ID and transport are provided, the session is registered
 * in hot state for hot-reload patching.
 */
const createServer = (sessionId?: string, transport?: TransportHandle, type?: 'sse' | 'stream'): McpServer => {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      // Coalesce rapid tool-change notifications (e.g., during hot reload) into
      // a single notification per event-loop tick via microtask scheduling.
      debouncedNotificationMethods: ['notifications/tools/list_changed'],
    },
  );

  const tools = registerAllTools(server);

  // Store session entry for hot-reload patching
  if (sessionId && transport && type) {
    registerSession(sessionId, { server, transport, type, tools });
  }

  return server;
};

/**
 * Start the WebSocket relay (only on first load, persisted across reloads)
 */
const startRelay = async (wsPort: number): Promise<void> => {
  const hotState = getHotState();

  // Persist relay in hot state for websocket-relay.ts to reuse
  if (!hotState.relay) {
    hotState.relay = relay;
  }

  // Only start if the WebSocket server isn't already listening
  if (!relay.isStarted()) {
    await relay.start(wsPort);
  }
};

/**
 * Start the server in HTTP mode (recommended)
 *
 * In HTTP mode, the server runs as a standalone process that multiple
 * Claude Code instances can connect to via SSE.
 */
const startHttpMode = async (config: ServerConfig): Promise<void> => {
  await startRelay(config.wsPort);

  // Pass server creation function - each client gets its own MCP server
  // but they all share the same WebSocket relay to the Chrome extension
  await startHttpServer(createServer, {
    port: config.httpPort,
    host: config.httpHost,
  });

  // Handle graceful shutdown (only register once on first load)
  if (!isHotReload()) {
    const shutdown = async (): Promise<void> => {
      console.error('[MCP] Shutting down...');
      await closeAllSessions();
      relay.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  if (!isHotReload()) {
    console.error('[MCP] Server started in HTTP mode');
    console.error('[MCP] Configure your MCP client with one of:');
    console.error(
      `[MCP]   Streamable HTTP (recommended): { "type": "streamable-http", "url": "http://${config.httpHost}:${config.httpPort}/mcp" }`,
    );
    console.error(`[MCP]   SSE: { "type": "sse", "url": "http://${config.httpHost}:${config.httpPort}/sse" }`);
  }
};

/**
 * Start the server in stdio mode.
 *
 * In stdio mode, each Claude Code instance spawns its own server process.
 * HTTP mode is recommended since it allows multiple clients to share one server.
 */
const startStdioMode = async (config: ServerConfig): Promise<void> => {
  await startRelay(config.wsPort);

  const server = createServer('stdio');
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error('[MCP] Server started in stdio mode');
};

/**
 * Handle a hot reload event.
 *
 * Hot-patches all existing MCP sessions with fresh tool definitions,
 * sending `notifications/tools/list_changed` to each connected client.
 * Also updates the server factory so new sessions use fresh tool code.
 *
 * Wrapped in a try/catch so a failed reload never crashes the server.
 * Existing sessions keep their previous (working) tools, and the next
 * file change triggers another reload attempt.
 */
const handleHotReload = (): void => {
  const hotState = getHotState();
  hotState.reloadCount++;

  console.error(`[MCP] Hot reload #${hotState.reloadCount} detected, updating tools...`);

  try {
    // Update the server factory so new sessions use fresh tool code
    hotState.createServerFn = createServer;

    // Hot-patch all existing sessions with fresh tool definitions
    hotPatchAllSessions(registerAllTools, McpServer, SERVER_NAME, SERVER_VERSION);

    console.error(`[MCP] Hot reload #${hotState.reloadCount} complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[MCP] Hot reload #${hotState.reloadCount} failed: ${message}`);
    hotState.lastReload = {
      success: false,
      timestamp: Date.now(),
      patchedSessions: 0,
      toolCount: 0,
      error: message,
    };
  }
};

/**
 * Start the server with the given configuration
 */
const startServer = async (config: ServerConfig): Promise<void> => {
  if (isHotReload()) {
    // On hot reload, patch existing sessions instead of restarting
    handleHotReload();
    return;
  }

  if (config.mode === 'http') {
    await startHttpMode(config);
  } else {
    await startStdioMode(config);
  }

  // Mark as initialized so subsequent module evaluations (hot reloads)
  // take the hot-reload path instead of re-initializing
  getHotState().initialized = true;
};

export { createServer, startHttpMode, startServer, startStdioMode };
