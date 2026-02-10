#!/usr/bin/env node

// MCP Server entry point
//
// The startup flow is:
//
// 1. Parse CLI config (or reuse from hot state)
// 2. Call startServer(config) which:
//    a. Starts the WebSocket relay
//    b. Initializes plugins (discover, load, wire request provider)
//    c. Starts HTTP or stdio transport
//    d. On hot reload: refreshes plugins and patches existing sessions

import { parseConfig, ConfigError } from './config.js';
import { getHotState } from './hot-reload.js';
import { startServer } from './server.js';
import type { ServerConfig } from './config.js';

// Persist config across hot reloads so CLI args don't need re-parsing
const hotState = getHotState();

let config: ServerConfig;
if (hotState.initialized && hotState.config) {
  config = hotState.config;
} else {
  try {
    config = parseConfig();
    hotState.config = config;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[MCP] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

startServer(config).catch((err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // Error message already printed by http-server or websocket-relay
    process.exit(1);
  }
  console.error('[MCP] Failed to start server:', err.message || err);
  process.exit(1);
});
