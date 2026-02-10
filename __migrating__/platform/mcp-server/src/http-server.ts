// HTTP server for MCP using SSE and Streamable HTTP transports
// This allows multiple Claude Code instances to connect to the same server
//
// Ported from packages/mcp-server/src/http-server.ts — adapted to use local
// imports instead of @extension/shared. No behavioral changes.

import { createFileSession, appendToFile, getFileSession } from './file-store.js';
import { getHotState, removeSession, getSession, closeAllSessions } from './hot-reload.js';
import { relay } from './websocket-relay.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { TransportHandle } from './hot-reload.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Request, Response } from 'express';

interface HttpServerOptions {
  port: number;
  host: string;
}

/**
 * Server factory function signature.
 * When sessionId, transport, and type are provided, the factory registers
 * the session in hot state for hot-reload patching.
 */
type CreateServerFn = (sessionId?: string, transport?: TransportHandle, type?: 'sse' | 'stream') => McpServer;

/**
 * Start the MCP server with SSE and Streamable HTTP transports
 *
 * This creates an Express server that handles MCP protocol messages.
 * Multiple clients can connect to the same server instance.
 *
 * On bun --hot reloads, the HTTP server and session state are preserved
 * via globalThis. Only tool handlers are hot-patched on existing sessions;
 * new sessions get fresh tool code automatically.
 *
 * Endpoints:
 * - /mcp - Streamable HTTP transport (recommended)
 * - /sse - SSE transport
 */
const startHttpServer = async (
  createServerFn: CreateServerFn,
  options: HttpServerOptions,
): Promise<{ close: () => Promise<void> }> => {
  const { port, host } = options;
  const hotState = getHotState();

  // Store the factory function in hot state so route handlers always use the latest.
  // On hot reload, server.ts updates this reference. Existing Express routes read
  // from hotState and automatically use the new factory for new sessions.
  hotState.createServerFn = createServerFn;

  // If HTTP server already exists from a previous hot reload, reuse it.
  // Sessions in hotState are already being tracked.
  if (hotState.httpServer) {
    console.error(`[MCP] Hot reload: reusing existing HTTP server on http://${host}:${port}`);
    return { close: closeAllSessions };
  }

  const app = express();

  // Parse JSON bodies for POST requests
  app.use(express.json());

  // CORS preflight handler for adapter requests from HTTPS pages to localhost
  const corsPreflightHandler = (_req: Request, res: Response): void => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.sendStatus(204);
  };

  // ============================================
  // Streamable HTTP transport endpoints (/mcp)
  // ============================================

  const handleMcpRequest = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // For initialization (no session ID), create new transport and server
    if (!sessionId && req.method === 'POST') {
      // Generate session ID upfront so we can pass it to createServerFn for tool tracking
      const newSessionId = randomUUID();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (sid: string) => {
          console.error(`[MCP] Streamable client connected (session: ${sid.slice(0, 8)}...)`);
        },
      });

      // Read from hotState to always use the latest factory (updated on hot reload).
      // Pass transport so the session is registered in hot state.
      const server = hotState.createServerFn!(newSessionId, transport, 'stream');

      transport.onclose = () => {
        if (transport.sessionId) {
          removeSession(transport.sessionId);
          console.error(`[MCP] Streamable client disconnected (session: ${transport.sessionId.slice(0, 8)}...)`);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // For existing sessions, look up the transport
    if (sessionId) {
      const entry = getSession(sessionId);
      if (!entry) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      await (entry.transport as StreamableHTTPServerTransport).handleRequest(req, res, req.body);
      return;
    }

    // GET without session ID - not allowed for streamable HTTP
    if (req.method === 'GET') {
      res.status(400).json({ error: 'Session ID required for GET requests' });
      return;
    }

    res.status(400).json({ error: 'Invalid request' });
  };

  app.get('/mcp', handleMcpRequest);
  app.post('/mcp', handleMcpRequest);
  app.delete('/mcp', handleMcpRequest);

  // ============================================
  // Legacy SSE transport endpoints (/sse)
  // ============================================

  app.get('/sse', async (_req: Request, res: Response) => {
    const transport = new SSEServerTransport('/sse', res);
    const sseSessionId = transport.sessionId;

    // Read from hotState to always use the latest factory (updated on hot reload).
    // Pass transport so the session is registered in hot state.
    const server = hotState.createServerFn!(sseSessionId, transport, 'sse');

    transport.onclose = () => {
      removeSession(sseSessionId);
      console.error(`[MCP] SSE client disconnected (session: ${sseSessionId.slice(0, 8)}...)`);
    };

    await server.connect(transport);

    console.error(`[MCP] SSE client connected (session: ${sseSessionId.slice(0, 8)}...)`);
  });

  app.post('/sse', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId parameter' });
      return;
    }

    const entry = getSession(sessionId);
    if (!entry) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await (entry.transport as SSEServerTransport).handlePostMessage(req, res, req.body);
  });

  // ============================================
  // File store endpoints — generic data streaming
  // from adapters to local files
  // ============================================

  // CORS preflight for adapter requests from HTTPS pages to localhost
  app.options('/files', corsPreflightHandler);
  app.options('/files/:fileId/append', corsPreflightHandler);
  app.options('/files/:fileId', corsPreflightHandler);

  // Create a new file session
  app.post('/files', (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    const { prefix, extension, initialContent } = req.body as {
      prefix?: string;
      extension?: string;
      initialContent?: string;
    };

    createFileSession(prefix, extension, initialContent ?? '')
      .then(session => res.json(session))
      .catch(err => res.status(500).json({ error: String(err) }));
  });

  // Append content to an existing file
  app.post('/files/:fileId/append', express.text({ type: '*/*', limit: '256mb' }), (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    const fileId = req.params.fileId as string;
    const content = req.body as string;

    appendToFile(fileId, content)
      .then(result => res.json(result))
      .catch(err => {
        const status = (err as Error).message.includes('not found') ? 404 : 500;
        res.status(status).json({ error: String(err) });
      });
  });

  // Get file session metadata
  app.get('/files/:fileId', (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    const fileId = req.params.fileId as string;
    const info = getFileSession(fileId);
    if (!info) {
      res.status(404).json({ error: 'File session not found' });
      return;
    }
    res.json(info);
  });

  // ============================================
  // Health check endpoint
  // ============================================

  app.get('/health', (_req: Request, res: Response) => {
    const extensionConnected = relay.isConnected();
    const sessions = hotState.sessions;

    let sseSessions = 0;
    let streamSessions = 0;
    for (const [, entry] of sessions) {
      if (entry.type === 'sse') sseSessions++;
      else streamSessions++;
    }

    res.json({
      status: extensionConnected ? 'ok' : 'degraded',
      sseSessions,
      streamSessions,
      extension: extensionConnected ? 'connected' : 'disconnected',
      hotReload: {
        reloadCount: hotState.reloadCount,
        lastReload: hotState.lastReload,
      },
    });
  });

  // Start listening
  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const srv = app.listen(port, host, () => {
      resolve(srv);
    });
    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[MCP] HTTP port ${port} is already in use.`);
        console.error('[MCP] Try: lsof -i :' + port + ' | grep LISTEN');
        console.error('[MCP] Or use a different port: --port <number>');
      }
      reject(err);
    });
  });

  // Persist HTTP server in hot state for reuse across reloads
  hotState.httpServer = httpServer;

  console.error(`[MCP] HTTP server listening on http://${host}:${port}`);
  console.error(`[MCP]   - Streamable HTTP: http://${host}:${port}/mcp (recommended)`);
  console.error(`[MCP]   - SSE (legacy):    http://${host}:${port}/sse`);

  return { close: closeAllSessions };
};

export { startHttpServer };
export type { CreateServerFn, HttpServerOptions };
