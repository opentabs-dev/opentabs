// Configuration for the MCP server
//
// Ported from packages/mcp-server/src/config.ts — faithful port with no
// dependency changes (this module has no @extension/shared imports).

type TransportMode = 'stdio' | 'http';

interface ServerConfig {
  /** Transport mode: 'stdio' for subprocess, 'http' for standalone server */
  mode: TransportMode;
  /** HTTP server port (only used in http mode) */
  httpPort: number;
  /** WebSocket port for Chrome extension connection */
  wsPort: number;
  /** HTTP server host (only used in http mode) */
  httpHost: string;
}

const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_WS_PORT = 8765;
const DEFAULT_HTTP_HOST = '127.0.0.1';

/**
 * Parse command line arguments and environment variables into server config
 */
const parseConfig = (argv: string[] = process.argv.slice(2)): ServerConfig => {
  const config: ServerConfig = {
    mode: 'http',
    httpPort: DEFAULT_HTTP_PORT,
    wsPort: DEFAULT_WS_PORT,
    httpHost: DEFAULT_HTTP_HOST,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === '--stdio') {
      config.mode = 'stdio';
    } else if (arg === '--http') {
      config.mode = 'http';
    } else if (arg === '--port' || arg === '-p') {
      const portStr = argv[++i]!;
      const port = parsePort(portStr, 'HTTP port');
      if (port !== null) config.httpPort = port;
    } else if (arg.startsWith('--port=')) {
      const port = parsePort(arg.split('=')[1]!, 'HTTP port');
      if (port !== null) config.httpPort = port;
    } else if (arg === '--ws-port') {
      const portStr = argv[++i]!;
      const port = parsePort(portStr, 'WebSocket port');
      if (port !== null) config.wsPort = port;
    } else if (arg.startsWith('--ws-port=')) {
      const port = parsePort(arg.split('=')[1]!, 'WebSocket port');
      if (port !== null) config.wsPort = port;
    } else if (arg === '--host') {
      config.httpHost = argv[++i] || DEFAULT_HTTP_HOST;
    } else if (arg.startsWith('--host=')) {
      config.httpHost = arg.split('=')[1] || DEFAULT_HTTP_HOST;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // Environment variable overrides (if not set via CLI)
  const envHttpPort = process.env.MCP_HTTP_PORT;
  if (envHttpPort && config.httpPort === DEFAULT_HTTP_PORT) {
    const port = parsePort(envHttpPort, 'MCP_HTTP_PORT');
    if (port !== null) config.httpPort = port;
  }

  const envWsPort = process.env.OPENTABS_PORT;
  if (envWsPort && config.wsPort === DEFAULT_WS_PORT) {
    const port = parsePort(envWsPort, 'OPENTABS_PORT');
    if (port !== null) config.wsPort = port;
  }

  const envHost = process.env.MCP_HTTP_HOST;
  if (envHost && config.httpHost === DEFAULT_HTTP_HOST) {
    config.httpHost = envHost;
  }

  return config;
};

/**
 * Error thrown when configuration is invalid
 */
class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const parsePort = (value: string | undefined, name: string): number | null => {
  if (!value) return null;
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ConfigError(`Invalid ${name}: ${value}. Port must be between 1 and 65535.`);
  }
  return port;
};

const printHelp = (): void => {
  console.log(`
OpenTabs MCP Server

Turns tabs into tools. An MCP server that connects AI agents to your browser tabs via a Chrome extension.

Usage: opentabs-mcp [options]

Transport Modes:
  --http              Run as HTTP server (default, recommended)
                      Multiple Claude Code instances can connect to the same server
  --stdio             Run with stdio transport (legacy mode)
                      Each Claude Code instance spawns its own server process

HTTP Mode Options:
  -p, --port <port>   HTTP server port (default: 3000)
  --host <host>       HTTP server host (default: 127.0.0.1)

Common Options:
  --ws-port <port>    WebSocket port for Chrome extension (default: 8765)
  -h, --help          Show this help message

Environment Variables:
  MCP_HTTP_PORT       HTTP server port (alternative to --port)
  MCP_HTTP_HOST       HTTP server host (alternative to --host)
  OPENTABS_PORT       WebSocket port (alternative to --ws-port)

Examples:
  # Start as HTTP server (recommended for multiple Claude Code instances)
  opentabs-mcp

  # Start on custom ports
  opentabs-mcp --port 3001 --ws-port 8766

  # Start in legacy stdio mode (not recommended)
  opentabs-mcp --stdio

Configuration:
  For HTTP mode, configure Claude Code with:
    {
      "mcpServers": {
        "opentabs": {
          "type": "streamable-http",
          "url": "http://127.0.0.1:3000/mcp"
        }
      }
    }

  For stdio mode (legacy), configure with:
    {
      "mcpServers": {
        "slack-delegate": {
          "command": "node",
          "args": ["/path/to/opentabs-mcp/dist/index.js", "--stdio"]
        }
      }
    }
`);
};

export { ConfigError, DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, DEFAULT_WS_PORT, parseConfig };
export type { ServerConfig, TransportMode };
