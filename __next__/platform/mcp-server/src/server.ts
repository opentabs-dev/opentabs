// ---------------------------------------------------------------------------
// MCP Server — creates and wires McpServer instances for each client session
// ---------------------------------------------------------------------------

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Version — read from package.json at module load time
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, '..', 'package.json');
const packageJson: { version?: string } = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
  version?: string;
};
const SERVER_VERSION = packageJson.version ?? '0.0.0';
const SERVER_NAME = 'opentabs';

// ---------------------------------------------------------------------------
// createMcpServer — factory for per-session McpServer instances
// ---------------------------------------------------------------------------

/**
 * Create a new McpServer instance for a client session.
 * Each HTTP client session gets its own McpServer; stdio mode uses a single instance.
 */
const createMcpServer = (): McpServer =>
  new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
    },
  );

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createMcpServer, SERVER_NAME, SERVER_VERSION };
