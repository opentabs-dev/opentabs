// ---------------------------------------------------------------------------
// MCP Server Configuration — parsed from env vars and CLI args
// ---------------------------------------------------------------------------

interface ServerConfig {
  /** HTTP port for Streamable HTTP + SSE transport (default: 3000) */
  readonly httpPort: number;
  /** WebSocket port for Chrome extension communication (default: 8080) */
  readonly wsPort: number;
  /** Host to bind HTTP server to (default: '127.0.0.1') */
  readonly httpHost: string;
  /** Transport mode: 'http' for multi-client HTTP, 'stdio' for single-client stdio (default: 'http') */
  readonly mode: 'http' | 'stdio';
}

const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_WS_PORT = 8080;
const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_MODE: ServerConfig['mode'] = 'http';

/**
 * Parse an integer from a string, returning undefined for invalid values.
 */
const parseIntSafe = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * Parse server configuration from environment variables and CLI arguments.
 * CLI arguments take precedence over env vars, env vars take precedence over defaults.
 *
 * Env vars:
 *   OPENTABS_HTTP_PORT, OPENTABS_WS_PORT, OPENTABS_HTTP_HOST, OPENTABS_MODE
 *
 * CLI args:
 *   --http-port <n>, --ws-port <n>, --http-host <host>, --mode <http|stdio>
 */
const parseConfig = (argv: readonly string[] = process.argv.slice(2)): ServerConfig => {
  const cliArgs = parseCli(argv);

  const httpPort = cliArgs.httpPort ?? parseIntSafe(process.env['OPENTABS_HTTP_PORT']) ?? DEFAULT_HTTP_PORT;

  const wsPort = cliArgs.wsPort ?? parseIntSafe(process.env['OPENTABS_WS_PORT']) ?? DEFAULT_WS_PORT;

  const httpHost = cliArgs.httpHost ?? process.env['OPENTABS_HTTP_HOST'] ?? DEFAULT_HTTP_HOST;

  const rawMode = cliArgs.mode ?? process.env['OPENTABS_MODE'] ?? DEFAULT_MODE;

  const mode: ServerConfig['mode'] = rawMode === 'stdio' ? 'stdio' : 'http';

  return { httpPort, wsPort, httpHost, mode };
};

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly httpPort?: number;
  readonly wsPort?: number;
  readonly httpHost?: string;
  readonly mode?: string;
}

const parseCli = (argv: readonly string[]): CliArgs => {
  let httpPort: number | undefined;
  let wsPort: number | undefined;
  let httpHost: string | undefined;
  let mode: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--http-port' && next !== undefined) {
      httpPort = parseIntSafe(next);
      i++;
    } else if (arg === '--ws-port' && next !== undefined) {
      wsPort = parseIntSafe(next);
      i++;
    } else if (arg === '--http-host' && next !== undefined) {
      httpHost = next;
      i++;
    } else if (arg === '--mode' && next !== undefined) {
      mode = next;
      i++;
    }
  }

  return { httpPort, wsPort, httpHost, mode };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { parseConfig, type ServerConfig };
