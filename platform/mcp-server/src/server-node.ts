/**
 * Node.js HTTP + WebSocket server.
 *
 * Uses node:http and the ws package. Converts between Node.js IncomingMessage /
 * ServerResponse and the Web Standard Request / Response objects that the
 * route handlers expect.
 *
 * Node.js 20+ has global Request / Response via undici, so no polyfills needed.
 */

import { log } from './logger.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { ServerAdapter } from './http-routes.js';
import type { WsHandle } from '@opentabs-dev/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { RawData } from 'ws';

/** Maximum HTTP request body size (10 MB, matching the WebSocket maxPayload) */
const MAX_BODY_SIZE = 10 * 1024 * 1024;

/** Thrown by collectBody when the incoming body exceeds MAX_BODY_SIZE */
class BodyTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_BODY_SIZE.toString()} byte limit`);
    this.name = 'BodyTooLargeError';
  }
}

/** Configuration for the Node.js HTTP + WebSocket server */
interface NodeServerOptions {
  hostname: string;
  port: number;
  fetch: (req: Request, server: ServerAdapter) => Promise<Response | undefined>;
  websocket: {
    open: (ws: WsHandle) => void;
    message: (ws: WsHandle, message: string | ArrayBuffer | Uint8Array) => void;
    close: (ws: WsHandle) => void;
  };
}

/** Return type for the Node.js server */
interface NodeServer {
  port: number;
  stop: () => void;
}

/** Send a Web Response through a Node.js ServerResponse */
const sendResponse = (webResponse: Response, res: ServerResponse): void => {
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));

  const body = webResponse.body;
  if (!body) {
    res.end();
    return;
  }

  // Handle ReadableStream (web streams) by piping to the Node.js response.
  // SSE responses from MCP Streamable HTTP transport use ReadableStream —
  // piping preserves the streaming behavior.
  const nodeStream = Readable.fromWeb(body as unknown as NodeReadableStream);
  nodeStream.pipe(res);
  nodeStream.on('error', err => {
    log.warn('Response stream error:', err);
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  });
  res.on('close', () => nodeStream.destroy());
};

/** Wrap a ws WebSocket to match the WsHandle interface used by handlers */
const wrapWs = (ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }): WsHandle => ({
  send: (data: string) => ws.send(data),
  close: (code?: number, reason?: string) => ws.close(code, reason),
});

/**
 * Convert a Node.js IncomingMessage to a Web Standard Request.
 */
const toWebRequest = (req: IncomingMessage, body: Buffer | null): Request => {
  const host = req.headers.host ?? 'localhost';
  const url = `http://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const init: RequestInit = {
    method,
    headers,
    body: hasBody && body ? new Uint8Array(body) : undefined,
  };

  // Node.js 20+ requires duplex: 'half' for requests with a body.
  if (hasBody) {
    (init as Record<string, unknown>)['duplex'] = 'half';
  }

  return new Request(url, init);
};

/** Collect the full request body from an IncomingMessage, up to MAX_BODY_SIZE bytes */
const collectBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/**
 * Handle an HTTP request by converting it to a Web Request, running the
 * fetch handler, and sending the Web Response back through the Node.js response.
 */
const handleHttpRequest = (
  options: NodeServerOptions,
  adapter: ServerAdapter,
  req: IncomingMessage,
  res: ServerResponse,
): void => {
  const run = async (): Promise<void> => {
    try {
      const body = req.method !== 'GET' && req.method !== 'HEAD' ? await collectBody(req) : null;
      const webReq = toWebRequest(req, body);
      const webRes = await options.fetch(webReq, adapter);
      if (webRes) {
        sendResponse(webRes, res);
      } else if (!res.headersSent) {
        res.writeHead(204);
        res.end();
      }
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        if (!res.headersSent) {
          res.writeHead(413);
          res.end('Payload Too Large');
        }
        return;
      }
      log.error('Unhandled error in HTTP handler:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    }
  };
  void run();
};

/**
 * Handle a WebSocket upgrade by running the fetch handler (which calls
 * adapter.upgrade()), then completing the upgrade via the ws library.
 */
const handleWsUpgradeEvent = (
  options: NodeServerOptions,
  adapter: ServerAdapter,
  wss: WebSocketServer,
  getUpgradeContext: () => { requested: boolean; headers?: HeadersInit } | null,
  setUpgradeContext: (ctx: { requested: boolean; headers?: HeadersInit } | null) => void,
  setPendingHeaders: (headers: Record<string, string>) => void,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void => {
  const run = async (): Promise<void> => {
    try {
      setUpgradeContext({ requested: false });

      const webReq = toWebRequest(req, null);
      await options.fetch(webReq, adapter);

      const ctx = getUpgradeContext();
      setUpgradeContext(null);

      if (!ctx?.requested) {
        socket.destroy();
        return;
      }

      // Stash custom headers (e.g., sec-websocket-protocol) so the 'headers'
      // event listener on the WebSocketServer can inject them into the 101 response.
      if (ctx.headers) {
        const h = new Headers(ctx.headers);
        const headerMap: Record<string, string> = {};
        for (const [key, value] of h) {
          headerMap[key] = value;
        }
        setPendingHeaders(headerMap);
      }

      wss.handleUpgrade(req, socket, head, ws => {
        const handle = wrapWs(ws);

        ws.on('message', (data: RawData, isBinary: boolean) => {
          if (isBinary) {
            if (Buffer.isBuffer(data)) {
              options.websocket.message(handle, new Uint8Array(data));
            } else if (data instanceof ArrayBuffer) {
              options.websocket.message(handle, data);
            }
          } else if (Buffer.isBuffer(data)) {
            options.websocket.message(handle, data.toString('utf-8'));
          } else if (Array.isArray(data)) {
            options.websocket.message(handle, Buffer.concat(data).toString('utf-8'));
          } else {
            options.websocket.message(handle, new TextDecoder().decode(data));
          }
        });

        ws.on('close', () => options.websocket.close(handle));

        options.websocket.open(handle);
      });
    } catch (err) {
      log.error('Unhandled error in WebSocket upgrade handler:', err);
      setUpgradeContext(null);
      socket.destroy();
    }
  };
  void run();
};

/**
 * Create a Node.js HTTP + WebSocket server that presents the ServerAdapter
 * interface to the MCP server route handlers.
 *
 * WebSocket upgrades are handled via the 'upgrade' event on the HTTP server,
 * which is separate from normal request handling. The 'upgrade' event
 * constructs a Web Request, calls the fetch handler (which calls
 * `adapter.upgrade()`), and if upgrade was requested, completes it via
 * `wss.handleUpgrade()`.
 */
const createNodeServer = (options: NodeServerOptions): Promise<NodeServer> =>
  new Promise((resolveServer, rejectServer) => {
    const wss = new WebSocketServer({
      noServer: true,
      /** Matches MAX_MESSAGE_SIZE in extension-protocol.ts and MAX_BODY_SIZE above */
      maxPayload: MAX_BODY_SIZE,
    });

    // The ws library emits 'headers' with the raw header lines just before
    // sending the 101 response. We use this to inject custom headers
    // from the route handler's upgrade call.
    //
    // Sec-WebSocket-Protocol is intentionally excluded here: ws selects the
    // protocol automatically (first value from the client's requested list),
    // so injecting it again would produce a duplicate header.
    let pendingUpgradeHeaders: Record<string, string> = {};
    wss.on('headers', (headers: string[]) => {
      for (const [key, value] of Object.entries(pendingUpgradeHeaders)) {
        if (key.toLowerCase() !== 'sec-websocket-protocol') {
          headers.push(`${key}: ${value}`);
        }
      }
      pendingUpgradeHeaders = {};
    });

    /**
     * Mutable ref set during upgrade event processing. The adapter.upgrade()
     * method reads/writes this to communicate upgrade intent back to the
     * 'upgrade' event handler.
     */
    let upgradeContext: { requested: boolean; headers?: HeadersInit } | null = null;

    const adapter: ServerAdapter = {
      upgrade: (_req: Request, opts: { data: unknown; headers?: HeadersInit }): boolean => {
        if (upgradeContext) {
          upgradeContext.requested = true;
          upgradeContext.headers = opts.headers;
          return true;
        }
        return false;
      },
      timeout: (): void => {
        // Node.js http server uses socket-level timeouts. The default is
        // sufficient — long-running MCP responses keep the socket open as
        // long as data is being written.
      },
    };

    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      handleHttpRequest(options, adapter, req, res);
    });

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      handleWsUpgradeEvent(
        options,
        adapter,
        wss,
        () => upgradeContext,
        ctx => {
          upgradeContext = ctx;
        },
        headers => {
          pendingUpgradeHeaders = headers;
        },
        req,
        socket,
        head,
      );
    });

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      rejectServer(err);
    });

    httpServer.listen(options.port, options.hostname, () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr !== null ? addr.port : options.port;

      resolveServer({
        port: actualPort,
        stop: () => {
          wss.close();
          httpServer.close();
        },
      });
    });
  });

export type { NodeServer, NodeServerOptions };
export { createNodeServer };
