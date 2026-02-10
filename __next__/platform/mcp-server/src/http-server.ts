// ---------------------------------------------------------------------------
// HTTP Server — Streamable HTTP (/mcp) and SSE (/sse) transports
// ---------------------------------------------------------------------------

import { createMcpServer } from './server.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { ServerConfig } from './config.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

/** Active Streamable HTTP sessions keyed by session ID */
const streamSessions = new Map<string, StreamableHTTPServerTransport>();

/** Active SSE sessions keyed by session ID */
const sseSessions = new Map<string, SSEServerTransport>();

const getStreamSessionCount = (): number => streamSessions.size;
const getSseSessionCount = (): number => sseSessions.size;

// ---------------------------------------------------------------------------
// Streamable HTTP handler — POST/GET/DELETE /mcp
// ---------------------------------------------------------------------------

const handleStreamableHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (req.method === 'POST') {
    if (sessionId !== undefined && streamSessions.has(sessionId)) {
      const transport = streamSessions.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createMcpServer();
    await server.connect(transport);

    await transport.handleRequest(req, res);

    if (transport.sessionId !== undefined) {
      streamSessions.set(transport.sessionId, transport);
    }

    transport.onclose = () => {
      if (transport.sessionId !== undefined) {
        streamSessions.delete(transport.sessionId);
      }
    };
    return;
  }

  if (req.method === 'GET') {
    if (sessionId !== undefined && streamSessions.has(sessionId)) {
      const transport = streamSessions.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid session ID for GET request' }));
    return;
  }

  if (req.method === 'DELETE') {
    if (sessionId !== undefined && streamSessions.has(sessionId)) {
      const transport = streamSessions.get(sessionId)!;
      await transport.close();
      streamSessions.delete(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
};

// ---------------------------------------------------------------------------
// SSE handler — GET /sse (establish stream), POST /sse (send message)
// ---------------------------------------------------------------------------

const handleSse = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (req.method === 'GET') {
    const transport = new SSEServerTransport('/sse', res);
    const server = createMcpServer();

    await server.connect(transport);

    sseSessions.set(transport.sessionId, transport);

    transport.onclose = () => {
      sseSessions.delete(transport.sessionId);
    };
    return;
  }

  if (req.method === 'POST') {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const sessionId = url.searchParams.get('sessionId');

    if (sessionId === null || !sseSessions.has(sessionId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing sessionId parameter' }));
      return;
    }

    const transport = sseSessions.get(sessionId)!;
    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const routeRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = req.url ?? '/';
  const pathname = url.split('?')[0];

  if (pathname === '/mcp') {
    await handleStreamableHttp(req, res);
    return;
  }

  if (pathname === '/sse') {
    await handleSse(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
};

// ---------------------------------------------------------------------------
// startHttpServer
// ---------------------------------------------------------------------------

/**
 * Start the HTTP server with Streamable HTTP and SSE transports.
 * Returns a cleanup function for graceful shutdown.
 */
const startHttpServer = (config: ServerConfig): { close: () => Promise<void> } => {
  const server = createServer((req, res) => {
    routeRequest(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[mcp-server] Request handler error:', message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });

  server.listen(config.httpPort, config.httpHost, () => {
    console.log(`[mcp-server] HTTP server listening on http://${config.httpHost}:${config.httpPort}`);
    console.log(`[mcp-server]   Streamable HTTP: http://${config.httpHost}:${config.httpPort}/mcp`);
    console.log(`[mcp-server]   SSE:             http://${config.httpHost}:${config.httpPort}/sse`);
  });

  const close = async (): Promise<void> => {
    for (const transport of streamSessions.values()) {
      await transport.close();
    }
    streamSessions.clear();

    for (const transport of sseSessions.values()) {
      await transport.close();
    }
    sseSessions.clear();

    await new Promise<void>((resolve, reject) => {
      server.close(err => {
        if (err !== undefined) reject(err);
        else resolve();
      });
    });
  };

  return { close };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { startHttpServer, getStreamSessionCount, getSseSessionCount };
