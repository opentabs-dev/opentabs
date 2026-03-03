/**
 * Dev reload WebSocket relay server.
 *
 * Accepts connections from extension clients and build signal senders.
 * When a BUILD_COMPLETE message with an `id` arrives, broadcasts a
 * DO_UPDATE message with the same `id` to all connected clients.
 *
 * Message protocol:
 *   Inbound:  { type: "build_complete", id: string }
 *   Outbound: { type: "do_update", id: string }
 */

import { createServer } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';

export interface DevReloadServer {
  /** Broadcast a DO_UPDATE message with the given target id to all connected clients. */
  broadcast(id: string): void;
  /** Shut down the relay server and close all connections. */
  close(): void;
}

interface BuildCompleteMessage {
  type: 'build_complete';
  id: string;
}

const isBuildCompleteMessage = (data: unknown): data is BuildCompleteMessage =>
  typeof data === 'object' &&
  data !== null &&
  (data as Record<string, unknown>).type === 'build_complete' &&
  typeof (data as Record<string, unknown>).id === 'string';

/**
 * Start a dev reload WebSocket relay server on the given port.
 *
 * Returns a handle to broadcast reload signals and close the server.
 * If the port is already in use, returns `null` (the caller should log
 * a warning and continue without dev reload signaling).
 */
export const startDevReloadServer = (port: number): Promise<DevReloadServer | null> =>
  new Promise(resolve => {
    const httpServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    httpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(null);
        return;
      }
      // Unexpected error — still resolve null to avoid crashing the orchestrator
      resolve(null);
    });

    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (raw: Buffer | string) => {
        try {
          const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
          if (isBuildCompleteMessage(parsed)) {
            broadcastUpdate(parsed.id);
          }
        } catch {
          // Ignore malformed messages
        }
      });
    });

    const broadcastUpdate = (id: string): void => {
      const payload = JSON.stringify({ type: 'do_update', id });
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
          client.send(payload);
        }
      }
    };

    httpServer.listen(port, () => {
      resolve({
        broadcast(id: string): void {
          broadcastUpdate(id);
        },
        close(): void {
          wss.close();
          httpServer.close();
        },
      });
    });
  });
