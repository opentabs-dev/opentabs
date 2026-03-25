/**
 * stdio-to-HTTP bridge for MCP clients that spawn the server as a child process.
 *
 * Instead of starting a second MCP server (which would conflict on the port),
 * this bridge connects to an existing HTTP server:
 *
 * 1. Check if the server is already running on the target port
 * 2. If not, start it in the background and wait for health
 * 3. Transparently proxy JSON-RPC from stdin to POST /mcp, responses to stdout
 * 4. Open a GET SSE stream for server-initiated notifications (tools/list_changed, logging)
 * 5. On stdin EOF, send DELETE /mcp to clean up the session, then exit
 *
 * The bridge does NOT pre-initialize -- it lets the client's own `initialize`
 * request pass through and captures the Mcp-Session-Id from the response.
 *
 * All diagnostic output goes to a log file and stderr -- never stdout,
 * which is reserved exclusively for the MCP protocol.
 */

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_PORT } from '@opentabs-dev/shared';
import { ensureAuthSecret, getConfigDir } from '../config.js';

const getLogsDir = (): string => join(getConfigDir(), 'logs');

const getStdioBridgeLogPath = async (): Promise<string> => {
  const logsDir = getLogsDir();
  await mkdir(logsDir, { recursive: true, mode: 0o700 });
  return join(logsDir, 'stdio-bridge.log');
};

type LogFn = (message: string) => void;

const createLogger = (logPath: string): { log: LogFn; close: () => void } => {
  const stream = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
  const log: LogFn = (message: string) => {
    const ts = new Date().toISOString();
    const line = `[stdio-bridge] ${ts} ${message}\n`;
    stream.write(line);
    process.stderr.write(line);
  };
  return { log, close: () => stream.end() };
};

const waitForHealth = async (port: number, secret: string, log: LogFn, maxWaitMs = 15_000): Promise<boolean> => {
  const url = `http://127.0.0.1:${String(port)}/health`;
  const start = Date.now();
  const interval = 500;
  while (Date.now() - start < maxWaitMs) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  log(`Server did not become healthy within ${String(maxWaitMs)}ms`);
  return false;
};

const isServerRunning = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const startBackgroundServer = async (port: number, log: LogFn): Promise<boolean> => {
  const { spawn } = await import('node:child_process');
  log(`Starting background server on port ${String(port)}...`);

  const cliEntry = process.argv[1] ?? 'opentabs';
  const child = spawn(process.execPath, [cliEntry, 'start', '--background', '--port', String(port)], {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();

  const crashed = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => {
      child.removeAllListeners('exit');
      resolve(false);
    }, 3000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  if (crashed) {
    log('Background server exited unexpectedly');
    return false;
  }

  return true;
};

/**
 * Extract all JSON data lines from an SSE response body.
 * SSE format: "event: message\ndata: {...}\n\n"
 */
const extractDataFromSse = (body: string): string[] => {
  const results: string[] = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data) results.push(data);
    }
  }
  return results;
};

/**
 * Open a long-running GET SSE stream for server-initiated notifications.
 * The MCP Streamable HTTP spec sends tools/list_changed, logging, and other
 * server notifications over a standalone GET stream (not as POST responses).
 */
const openNotificationStream = (
  mcpUrl: string,
  sessionId: string,
  secret: string,
  log: LogFn,
  abortController: AbortController,
): void => {
  const streamUrl = mcpUrl;
  const doOpen = async (): Promise<void> => {
    try {
      const response = await fetch(streamUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${secret}`,
          'Mcp-Session-Id': sessionId,
        },
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        log(`Notification stream failed: ${String(response.status)}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by double newlines)
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() ?? '';

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data) {
                process.stdout.write(`${data}\n`);
                log(`<< notification: ${data.slice(0, 100)}...`);
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      if (abortController.signal.aborted) return;
      const msg = error instanceof Error ? error.message : String(error);
      log(`Notification stream error: ${msg}`);
    }
  };

  doOpen().catch(() => {});
};

/**
 * Send DELETE /mcp to clean up the HTTP session on disconnect.
 */
const deleteSession = async (mcpUrl: string, sessionId: string, secret: string, log: LogFn): Promise<void> => {
  try {
    await fetch(mcpUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Mcp-Session-Id': sessionId,
      },
      signal: AbortSignal.timeout(5000),
    });
    log('Session deleted');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`Failed to delete session: ${msg}`);
  }
};

/**
 * Main bridge loop: transparently proxy JSON-RPC between stdin/stdout and HTTP /mcp.
 *
 * The bridge does NOT pre-initialize. The client sends its own `initialize` request,
 * which the bridge forwards to the server. The bridge captures the Mcp-Session-Id
 * from the response and uses it for all subsequent requests.
 */
const runBridge = async (port: number, secret: string, log: LogFn): Promise<void> => {
  const mcpUrl = `http://127.0.0.1:${String(port)}/mcp`;
  let sessionId: string | null = null;
  const notificationAbort = new AbortController();

  const baseHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${secret}`,
    };
    if (sessionId) h['Mcp-Session-Id'] = sessionId;
    return h;
  };

  const rl = createInterface({ input: process.stdin });
  const inflight = new Set<Promise<void>>();

  let buffer = '';

  rl.on('line', (line: string) => {
    buffer += line;

    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer);
    } catch {
      return;
    }
    buffer = '';

    const message = parsed as Record<string, unknown>;
    const isNotification = !('id' in message);
    const method = message.method as string | undefined;

    log(`-> ${method ?? 'response'}${isNotification ? ' (notification)' : ''}`);

    const work = (async () => {
    try {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify(parsed),
        signal: AbortSignal.timeout(300_000),
      });

      // Capture session ID from the initialize response
      if (method === 'initialize' && !sessionId) {
        const newSessionId = response.headers.get('mcp-session-id');
        if (newSessionId) {
          sessionId = newSessionId;
          log(`Session established: ${sessionId}`);

          // Now that we have a session, open the notification stream
          openNotificationStream(mcpUrl, sessionId, secret, log, notificationAbort);
        }
      }

      if (isNotification) {
        return;
      }

      const body = await response.text();

      // SSE responses contain one or more "data: {...}" lines
      if (body.includes('event: ') || body.includes('data: ')) {
        for (const data of extractDataFromSse(body)) {
          process.stdout.write(`${data}\n`);
          log(`<- ${data.slice(0, 100)}...`);
        }
      } else if (body.trim()) {
        process.stdout.write(`${body}\n`);
        log(`<- ${body.slice(0, 100)}...`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Error proxying request: ${errorMessage}`);

      if ('id' in message) {
        const errorResponse = JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: `Bridge proxy error: ${errorMessage}` },
        });
        process.stdout.write(`${errorResponse}\n`);
      }
    }
    })();
    inflight.add(work);
    work.finally(() => inflight.delete(work));
  });

  // stdin EOF = MCP client disconnected; wait for in-flight requests to finish
  await new Promise<void>(resolve => {
    rl.on('close', () => {
      log('stdin closed, waiting for in-flight requests...');
      resolve();
    });
  });
  if (inflight.size > 0) {
    await Promise.allSettled(inflight);
  }

  // Clean up: abort notification stream and delete session
  notificationAbort.abort();
  if (sessionId) {
    await deleteSession(mcpUrl, sessionId, secret, log);
  }
};

/**
 * Entry point for `opentabs start --stdio`.
 */
export const handleStdioBridge = async (port?: number): Promise<void> => {
  const targetPort = port ?? DEFAULT_PORT;
  const logPath = await getStdioBridgeLogPath();
  const { log, close: closeLog } = createLogger(logPath);

  log(`Bridge starting (target port: ${String(targetPort)})`);

  const secret = await ensureAuthSecret();

  const running = await isServerRunning(targetPort);
  if (!running) {
    log('Server not running, starting in background...');
    const started = await startBackgroundServer(targetPort, log);
    if (!started) {
      log('Failed to start background server');
      process.exit(1);
    }
    const healthy = await waitForHealth(targetPort, secret, log);
    if (!healthy) {
      log('Server failed health check after background start');
      process.exit(1);
    }
    log('Background server is healthy');
  } else {
    log('Server already running');
  }

  await runBridge(targetPort, secret, log);

  log('Bridge exiting');
  closeLog();
};
