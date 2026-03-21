/**
 * Dev proxy for hot reload with MCP session persistence.
 *
 * Listens on the configured port. Forks the MCP server (dist/index.js) on
 * an ephemeral port (PORT=0). The worker reports its actual port to the proxy
 * via IPC once it is listening. Forwards HTTP and WebSocket traffic to the
 * current worker. Restarts the worker when .js files in the dist/ directory
 * change (debounced). Incoming HTTP requests are buffered during restarts and
 * drained once the new worker is ready (up to 5 seconds, then 503).
 *
 * MCP session bridging: The proxy assigns its own stable session ID to each
 * MCP client. When a worker restarts, the proxy re-initializes the MCP session
 * with the new worker on behalf of connected clients, mapping the stable proxy
 * session ID to the new worker session ID. SSE GET streams are held open across
 * worker restarts — the proxy reconnects the upstream SSE stream to the new
 * worker and resumes forwarding events to the client.
 */

import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { DEFAULT_HOST, DEFAULT_PORT, sanitizeEnv } from '@opentabs-dev/shared';
import { WebSocket, WebSocketServer } from 'ws';

const WORKER_JS = resolve(import.meta.dirname, 'index.js');
const DIST_DIR = resolve(import.meta.dirname);
const PROXY_PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const DEBOUNCE_MS = 300;
const READY_TIMEOUT_MS = 5000;

let workerPort: number | null = null;
let worker: ChildProcess | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pending: Array<() => void> = [];
let workerStartCount = 0;

/** Runtime override for skipPermissions, set via IPC when the user clicks
 *  'Restore approvals'. null = no override (pass through from parent env). */
let skipPermissionsOverride: boolean | null = null;

// --- MCP Session State ---

/** Tracked state for each MCP client session that the proxy manages. */
interface ProxySession {
  /** Stable session ID exposed to the client (never changes). */
  proxySessionId: string;
  /** Current worker's session ID (changes on each worker restart). */
  workerSessionId: string;
  /** The JSON body of the client's initialize request (replayed to new workers). */
  initializeBody: unknown;
  /** Active SSE response streams for this session. */
  sseStreams: Set<ServerResponse>;
  /** Authorization header value from the client (forwarded to the worker). */
  authHeader: string | null;
  /** Original URL path for this session (e.g., '/mcp' or '/mcp/gateway'). */
  path: string;
  /**
   * The single upstream SSE connection to the worker for this session.
   * The MCP SDK enforces exactly one GET SSE stream per session — opening a
   * second returns 409 Conflict. The proxy maintains one upstream connection
   * and fans out SSE data to all client responses in sseStreams.
   *
   * `req` is set when the GET is sent (used to abort during disconnect).
   * `res` is set when the worker responds 200 (used for data fan-out).
   */
  upstreamSse: {
    req: ReturnType<typeof httpRequest>;
    res: IncomingMessage | null;
  } | null;
}

/** Map from proxy session ID → session state. */
const sessions = new Map<string, ProxySession>();

/** Reverse map from worker session ID → proxy session ID for fast lookup. */
const workerToProxySession = new Map<string, string>();

/** Drain all buffered requests now that the worker is ready. */
const drainPending = (): void => {
  for (const fn of pending.splice(0)) fn();
};

/**
 * Re-initialize all tracked MCP sessions with the new worker.
 * Sends the original initialize request + notifications/initialized to the
 * new worker for each session, capturing the new worker session IDs.
 * Then reconnects SSE streams.
 */
const reinitializeSessions = async (port: number): Promise<void> => {
  const sessionsToReinit = [...sessions.values()];
  if (sessionsToReinit.length === 0) return;

  console.log(`[proxy] Re-initializing ${sessionsToReinit.length} MCP session(s) with new worker`);

  for (const session of sessionsToReinit) {
    try {
      // Remove old worker session mapping
      workerToProxySession.delete(session.workerSessionId);

      // Send the original initialize request to the new worker
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (session.authHeader) {
        headers.Authorization = session.authHeader;
      }

      const initRes = await fetch(`http://127.0.0.1:${port}${session.path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(session.initializeBody),
        signal: AbortSignal.timeout(READY_TIMEOUT_MS),
      });

      if (!initRes.ok) {
        const text = await initRes.text().catch(() => '');
        console.error(`[proxy] Failed to re-initialize session ${session.proxySessionId}: ${initRes.status} ${text}`);
        cleanupSession(session.proxySessionId);
        continue;
      }

      const newWorkerSessionId = initRes.headers.get('mcp-session-id');
      if (!newWorkerSessionId) {
        console.error(`[proxy] Re-initialize did not return session ID for ${session.proxySessionId}`);
        cleanupSession(session.proxySessionId);
        continue;
      }

      // Update session mapping
      session.workerSessionId = newWorkerSessionId;
      workerToProxySession.set(newWorkerSessionId, session.proxySessionId);

      // Consume the initialize response body
      await initRes.text().catch(() => {});

      // Send notifications/initialized
      const notifHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': newWorkerSessionId,
      };
      if (session.authHeader) {
        notifHeaders.Authorization = session.authHeader;
      }

      await fetch(`http://127.0.0.1:${port}${session.path}`, {
        method: 'POST',
        headers: notifHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
        signal: AbortSignal.timeout(READY_TIMEOUT_MS),
      }).catch(() => {});

      console.log(`[proxy] Session ${session.proxySessionId} re-initialized (worker session: ${newWorkerSessionId})`);

      // Prune dead client responses, then reconnect the single upstream SSE.
      // The previous upstream died with the old worker — disconnect clears the
      // reference so connectUpstreamSse opens a fresh one to the new worker.
      for (const clientRes of session.sseStreams) {
        if (clientRes.destroyed || clientRes.writableEnded) {
          session.sseStreams.delete(clientRes);
        }
      }
      if (session.sseStreams.size > 0) {
        disconnectUpstreamSse(session);
        connectUpstreamSse(session, port);
      }
    } catch (err) {
      console.error(
        `[proxy] Error re-initializing session ${session.proxySessionId}:`,
        err instanceof Error ? err.message : err,
      );
      cleanupSession(session.proxySessionId);
    }
  }
};

/** Remove a session and clean up its resources. */
const cleanupSession = (proxySessionId: string): void => {
  const session = sessions.get(proxySessionId);
  if (!session) return;
  workerToProxySession.delete(session.workerSessionId);
  disconnectUpstreamSse(session);
  for (const res of session.sseStreams) {
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
  session.sseStreams.clear();
  sessions.delete(proxySessionId);
};

/**
 * Start (or restart) the worker. Kills the previous worker if running,
 * forks a new one with PORT=0 and OPENTABS_PROXY=1, then waits for the
 * 'ready' IPC message containing the worker's actual ephemeral port.
 */
const startWorker = (): void => {
  if (worker) {
    worker.kill('SIGTERM');
    worker = null;
    workerPort = null;
  }

  workerStartCount++;
  const isRestart = workerStartCount > 1;

  const envOverrides: Record<string, string> = {
    PORT: '0',
    OPENTABS_PROXY: '1',
  };
  if (skipPermissionsOverride !== null) {
    envOverrides.OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS = skipPermissionsOverride ? '1' : '';
  }
  const env = sanitizeEnv({ ...process.env, ...envOverrides });
  const child = fork(WORKER_JS, ['--dev'], { env });
  worker = child;

  child.on('message', (msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return;

    const type = (msg as { type?: unknown }).type;

    if (type === 'ready' && typeof (msg as { port?: unknown }).port === 'number') {
      workerPort = (msg as { type: string; port: number }).port;
      console.log(`[proxy] Worker ready on port ${workerPort}`);

      if (isRestart) {
        // Re-initialize existing MCP sessions with the new worker before
        // draining pending requests, so session mappings are ready.
        void reinitializeSessions(workerPort).then(() => {
          console.log('Hot reload complete');
          drainPending();
        });
      } else {
        drainPending();
      }
    } else if (type === 'skipPermissions' && typeof (msg as { value?: unknown }).value === 'boolean') {
      skipPermissionsOverride = (msg as { value: boolean }).value;
    }
  });

  child.on('exit', code => {
    if (worker === child) {
      worker = null;
      workerPort = null;
      console.log(`[proxy] Worker exited (code ${code ?? 'null'})`);
    }
  });
};

/**
 * Run fn when the worker is ready. Runs immediately if already ready.
 * Otherwise buffers fn until the worker reports ready via IPC, calling
 * onTimeout if the worker does not become ready within READY_TIMEOUT_MS.
 */
const whenReady = (fn: () => void, onTimeout: () => void): void => {
  if (workerPort !== null) {
    fn();
    return;
  }

  // settled prevents double-invocation if the timeout fires concurrently
  // with drainPending (single-threaded, but both check settled).
  let settled = false;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      pending.splice(pending.indexOf(entry), 1);
      onTimeout();
    }
  }, READY_TIMEOUT_MS);

  const entry = (): void => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      fn();
    }
  };

  pending.push(entry);
};

/** Forward an HTTP request to the worker via node:http. */
const proxyHttp = (req: IncomingMessage, res: ServerResponse, port: number): void => {
  const proxyReq = httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: req.url ?? '/',
      method: req.method,
      headers: req.headers,
    },
    proxyRes => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
      res.on('close', () => proxyRes.destroy());
    },
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });
  req.pipe(proxyReq);
};

// --- MCP-aware HTTP handling ---

/** Read the full request body as a string. */
const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });

/**
 * Destroy the current upstream SSE connection for a session so the worker's
 * transport removes its `_GET_stream` entry and a new GET can succeed.
 */
const disconnectUpstreamSse = (session: ProxySession): void => {
  if (session.upstreamSse) {
    session.upstreamSse.req.destroy();
    session.upstreamSse = null;
  }
};

/**
 * Connect a single upstream SSE stream from the worker for this session.
 * The MCP SDK enforces exactly one GET SSE stream per session (returns 409
 * Conflict for a second). The proxy maintains one upstream connection and
 * fans out SSE data to all client responses in session.sseStreams.
 *
 * If an upstream SSE is already active, this is a no-op. To force a
 * reconnect (e.g., after worker restart), call disconnectUpstreamSse first.
 */
const connectUpstreamSse = (session: ProxySession, port: number): void => {
  // Already connected or connection in flight — nothing to do. Data is
  // fanned out to all client responses in the 'data' handler below.
  if (session.upstreamSse) return;

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'mcp-session-id': session.workerSessionId,
  };
  if (session.authHeader) {
    headers.Authorization = session.authHeader;
  }

  const upstreamReq = httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: session.path,
      method: 'GET',
      headers,
    },
    upstreamRes => {
      if (upstreamRes.statusCode !== 200) {
        console.warn(
          `[proxy] Upstream SSE rejected for session ${session.proxySessionId} (status ${upstreamRes.statusCode})`,
        );
        upstreamRes.resume();
        // Connection failed — clear so a retry can be attempted
        session.upstreamSse = null;
        return;
      }

      // Promote from "connecting" to "connected" by setting res
      if (session.upstreamSse) {
        session.upstreamSse.res = upstreamRes;
      }

      // Fan out SSE data to all active client responses
      upstreamRes.on('data', (chunk: Buffer) => {
        for (const clientRes of session.sseStreams) {
          if (!clientRes.destroyed && !clientRes.writableEnded) {
            clientRes.write(chunk);
          }
        }
      });

      // When upstream closes (worker restart), clear the reference so
      // reinitializeSessions() can open a fresh connection.
      upstreamRes.on('end', () => {
        session.upstreamSse = null;
      });

      upstreamRes.on('error', () => {
        session.upstreamSse = null;
      });
    },
  );

  upstreamReq.on('error', () => {
    // Worker is down — clear the connection state so reconnection can be
    // attempted after the worker restarts.
    session.upstreamSse = null;
  });

  // Set immediately so concurrent calls see a connection is in flight
  session.upstreamSse = { req: upstreamReq, res: null };

  upstreamReq.end();
};

/**
 * Handle an MCP POST request. Intercepts initialize requests to track sessions,
 * rewrites session IDs for existing sessions, and forwards to the worker.
 */
const handleMcpPost = async (req: IncomingMessage, res: ServerResponse, port: number): Promise<void> => {
  const bodyStr = await readBody(req);
  let body: unknown;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400);
    res.end('Invalid JSON');
    return;
  }

  const isInitialize =
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>).method === 'initialize' &&
    (body as Record<string, unknown>).jsonrpc === '2.0';

  const clientSessionId = req.headers['mcp-session-id'] as string | undefined;

  if (isInitialize) {
    // Forward initialize to the worker (no session ID header)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: req.headers.accept ?? 'application/json, text/event-stream',
    };
    const authHeader = req.headers.authorization;
    if (authHeader) {
      headers.Authorization = authHeader;
    }
    // Forward Host header for DNS rebinding protection
    if (req.headers.host) {
      headers.Host = req.headers.host;
    }

    const mcpPath = req.url ?? '/mcp';
    const workerRes = await fetch(`http://127.0.0.1:${port}${mcpPath}`, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(READY_TIMEOUT_MS),
    });

    const workerSessionId = workerRes.headers.get('mcp-session-id');
    const responseBody = await workerRes.text();

    if (workerRes.ok && workerSessionId) {
      // Create a proxy session
      const proxySessionId = randomUUID();

      const session: ProxySession = {
        proxySessionId,
        workerSessionId,
        initializeBody: body,
        sseStreams: new Set(),
        authHeader: authHeader ?? null,
        path: mcpPath,
        upstreamSse: null,
      };
      sessions.set(proxySessionId, session);
      workerToProxySession.set(workerSessionId, proxySessionId);

      // Forward the response with the proxy session ID
      const resHeaders: Record<string, string> = {
        'content-type': workerRes.headers.get('content-type') ?? 'application/json',
        'mcp-session-id': proxySessionId,
      };
      res.writeHead(workerRes.status, resHeaders);
      res.end(responseBody);
    } else {
      // Forward error response as-is
      const resHeaders: Record<string, string> = {};
      const ct = workerRes.headers.get('content-type');
      if (ct) resHeaders['content-type'] = ct;
      res.writeHead(workerRes.status, resHeaders);
      res.end(responseBody);
    }
    return;
  }

  // Non-initialize POST — look up the session and rewrite the session ID
  if (clientSessionId) {
    const session = sessions.get(clientSessionId);
    if (session) {
      // Rewrite the session ID header to the current worker session ID
      const forwardHeaders: Record<string, string | string[] | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (key === 'mcp-session-id') {
          forwardHeaders[key] = session.workerSessionId;
        } else {
          forwardHeaders[key] = value;
        }
      }

      const proxyReq = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: session.path,
          method: 'POST',
          headers: forwardHeaders,
        },
        proxyRes => {
          // Rewrite the session ID in the response back to the proxy session ID
          const outHeaders: Record<string, string | string[] | undefined> = {};
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (key === 'mcp-session-id') {
              outHeaders[key] = session.proxySessionId;
            } else {
              outHeaders[key] = value;
            }
          }
          res.writeHead(proxyRes.statusCode ?? 200, outHeaders);
          proxyRes.pipe(res);
          res.on('close', () => proxyRes.destroy());
        },
      );
      proxyReq.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502);
          res.end('Bad Gateway');
        }
      });
      proxyReq.write(bodyStr);
      proxyReq.end();
      return;
    }
  }

  // Unknown session or no session header — forward as-is
  const proxyReq = httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: req.url ?? '/mcp',
      method: 'POST',
      headers: req.headers,
    },
    proxyRes => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
      res.on('close', () => proxyRes.destroy());
    },
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });
  proxyReq.write(bodyStr);
  proxyReq.end();
};

/**
 * Handle an MCP GET request (SSE stream). The proxy keeps the client-facing
 * SSE response alive across worker restarts by reconnecting the upstream
 * SSE stream to the new worker.
 */
const handleMcpGet = (req: IncomingMessage, res: ServerResponse, port: number): void => {
  const clientSessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!clientSessionId) {
    proxyHttp(req, res, port);
    return;
  }

  const session = sessions.get(clientSessionId);
  if (!session) {
    proxyHttp(req, res, port);
    return;
  }

  // Write SSE headers to the client — the proxy owns this response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'mcp-session-id': session.proxySessionId,
  });

  // Track this SSE stream for reconnection after worker restart
  session.sseStreams.add(res);

  res.on('close', () => {
    session.sseStreams.delete(res);
    // If this was the last client SSE stream, disconnect the upstream too —
    // no point keeping it open with no one to fan out to.
    if (session.sseStreams.size === 0) {
      disconnectUpstreamSse(session);
    }
    // Do NOT clean up the session itself when SSE streams close. The MCP
    // client (e.g., OpenCode) still holds the proxy session ID and can
    // re-establish an SSE stream with a new GET /mcp. Sessions are cleaned
    // up only via explicit DELETE /mcp or when the proxy restarts.
  });

  // Connect the upstream SSE stream if not already active. The MCP SDK
  // allows exactly one GET SSE stream per session — the proxy maintains one
  // upstream and fans out data to all client responses in sseStreams.
  connectUpstreamSse(session, port);
};

/**
 * Handle an MCP DELETE request. Rewrites session ID and cleans up.
 */
const handleMcpDelete = (req: IncomingMessage, res: ServerResponse, port: number): void => {
  const clientSessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!clientSessionId) {
    proxyHttp(req, res, port);
    return;
  }

  const session = sessions.get(clientSessionId);
  if (!session) {
    proxyHttp(req, res, port);
    return;
  }

  // Rewrite session ID and forward
  const forwardHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key === 'mcp-session-id') {
      forwardHeaders[key] = session.workerSessionId;
    } else {
      forwardHeaders[key] = value;
    }
  }

  const proxyReq = httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: session.path,
      method: 'DELETE',
      headers: forwardHeaders,
    },
    proxyRes => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
      res.on('close', () => proxyRes.destroy());
    },
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });
  proxyReq.end();

  // Clean up the session
  cleanupSession(session.proxySessionId);
};

/**
 * Route an MCP request to the appropriate handler based on HTTP method.
 */
const handleMcpRequest = (req: IncomingMessage, res: ServerResponse, port: number): void => {
  if (req.method === 'GET') {
    handleMcpGet(req, res, port);
  } else if (req.method === 'POST') {
    void handleMcpPost(req, res, port);
  } else if (req.method === 'DELETE') {
    handleMcpDelete(req, res, port);
  } else {
    res.writeHead(405);
    res.end('Method not allowed');
  }
};

// WebSocketServer in noServer mode — used only to complete client-side upgrades.
// handleProtocols returns false to suppress ws's automatic protocol selection;
// the 'headers' event injects the Sec-WebSocket-Protocol echo from the worker.
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: () => false,
});
let pendingWsProtocol: string | null = null;
wss.on('headers', (headers: string[]) => {
  if (pendingWsProtocol !== null) {
    headers.push(`Sec-WebSocket-Protocol: ${pendingWsProtocol}`);
    pendingWsProtocol = null;
  }
});

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const isMcpRequest = (req.url ?? '/').startsWith('/mcp');

  whenReady(
    () => {
      if (workerPort !== null) {
        if (isMcpRequest) {
          handleMcpRequest(req, res, workerPort);
        } else {
          proxyHttp(req, res, workerPort);
        }
      } else {
        res.writeHead(503);
        res.end('Service Unavailable');
      }
    },
    () => {
      res.writeHead(503);
      res.end('Service Unavailable');
    },
  );
});

/** Forward a WebSocket upgrade to the worker, buffering during restart. */
const forwardUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer, port: number): void => {
  // Extract Sec-WebSocket-Protocol from the client's request and pass it as
  // the protocols argument to the upstream WebSocket constructor. The ws
  // library validates that the server only echoes back protocols that were
  // requested — but only when they are provided via the protocols argument,
  // not when embedded in the headers option.
  const rawProtocol = req.headers['sec-websocket-protocol'] as string | string[] | undefined;
  const requestedProtocols: string[] = rawProtocol
    ? Array.isArray(rawProtocol)
      ? rawProtocol.flatMap(p => p.split(/, */))
      : rawProtocol.split(/, */)
    : [];

  // Build forward headers without sec-websocket-protocol (handled via protocols arg).
  const forwardHeaders: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key !== 'sec-websocket-protocol') {
      forwardHeaders[key] = value;
    }
  }

  const upstream = new WebSocket(
    `ws://127.0.0.1:${port}${req.url ?? '/'}`,
    requestedProtocols.length > 0 ? requestedProtocols : undefined,
    { headers: forwardHeaders },
  );

  upstream.on('open', () => {
    // Forward the Sec-WebSocket-Protocol echo from the worker to the client.
    if (upstream.protocol) {
      pendingWsProtocol = upstream.protocol;
    }
    wss.handleUpgrade(req, socket, head, client => {
      client.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      });
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });
      client.on('close', () => upstream.close());
      upstream.on('close', () => client.close());
      upstream.on('error', () => client.terminate());
      client.on('error', () => upstream.terminate());
    });
  });

  upstream.on('error', err => {
    console.error(`[proxy] WebSocket upstream error: ${err.message}`);
    socket.destroy();
  });
};

httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  whenReady(
    () => {
      if (workerPort !== null) {
        forwardUpgrade(req, socket, head, workerPort);
      } else {
        socket.destroy();
      }
    },
    () => {
      socket.destroy();
    },
  );
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[proxy] Port ${PROXY_PORT} is already in use`);
  } else {
    console.error('[proxy] Dev proxy error:', err);
  }
  process.exit(1);
});

httpServer.listen(PROXY_PORT, '127.0.0.1', () => {
  const actualPort = (httpServer.address() as { port: number }).port;
  console.log(`[proxy] Dev proxy listening on http://${DEFAULT_HOST}:${actualPort}`);
  startWorker();
});

// Watch dist/ for .js file changes (excluding dev-proxy.js itself) and restart
// the worker, debounced to handle tsc writing multiple files in one compilation.
watch(DIST_DIR, { recursive: true }, (_event, filename) => {
  if (typeof filename === 'string' && filename.endsWith('.js') && filename !== 'dev-proxy.js') {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      console.log('[proxy] Code change detected, restarting worker...');
      startWorker();
    }, DEBOUNCE_MS);
  }
});

// Graceful shutdown: kill the worker when the proxy exits.
process.on('SIGTERM', () => {
  worker?.kill('SIGTERM');
  process.exit(0);
});
process.on('SIGINT', () => {
  worker?.kill('SIGTERM');
  process.exit(0);
});

// SIGUSR1: triggered by test fixtures via triggerHotReload() to simulate
// a code change without modifying files on disk. Restarts the worker.
// Windows does not support SIGUSR1 — skip registration to avoid silent failures.
if (process.platform !== 'win32') {
  process.on('SIGUSR1', () => {
    console.log('[proxy] Hot reload triggered, restarting worker...');
    startWorker();
  });
}
