// ---------------------------------------------------------------------------
// @opentabs/mcp-server — entry point
// ---------------------------------------------------------------------------

import { parseConfig } from './config.js';
import { startHttpServer } from './http-server.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// ---------------------------------------------------------------------------
// startServer — dispatches to HTTP or stdio mode
// ---------------------------------------------------------------------------

const startServer = async (): Promise<void> => {
  const config = parseConfig();

  console.log(`[mcp-server] ${SERVER_NAME} v${SERVER_VERSION}`);
  console.log(`[mcp-server] Mode: ${config.mode}`);

  if (config.mode === 'stdio') {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('[mcp-server] Stdio transport connected');
    return;
  }

  const httpServer = startHttpServer(config);

  const shutdown = async (): Promise<void> => {
    console.log('\n[mcp-server] Shutting down...');
    await httpServer.close();
    console.log('[mcp-server] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

startServer().catch((err: unknown) => {
  console.error('[mcp-server] Fatal error:', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { parseConfig, type ServerConfig } from './config.js';
export { startHttpServer, getStreamSessionCount, getSseSessionCount } from './http-server.js';
export { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';
export { WebSocketRelay, relay, type ExtensionStatus } from './websocket-relay.js';
