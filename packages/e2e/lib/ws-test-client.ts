import { WebSocket } from 'ws';
import type { Data as WsData } from 'ws';

export interface WsTestClient {
  isConnected: () => boolean;
  send: (data: unknown) => void;
  waitForMessage: (timeoutMs?: number) => Promise<unknown>;
  waitForConnection: (timeoutMs?: number) => Promise<void>;
  getMessages: () => unknown[];
  close: () => void;
}

/**
 * Create a WebSocket client for testing the relay
 *
 * This simulates what the Chrome extension does when connecting
 * to the MCP server's WebSocket relay.
 */
export const createWsTestClient = (wsPort: number): WsTestClient => {
  const messages: unknown[] = [];
  const messageResolvers: Array<(value: unknown) => void> = [];
  let connectionResolvers: Array<() => void> = [];
  let ws: WebSocket | null = null;
  let connected = false;

  ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);

  ws.on('open', () => {
    connected = true;
    for (const resolver of connectionResolvers) {
      resolver();
    }
    connectionResolvers = [];
  });

  ws.on('message', (data: WsData) => {
    try {
      const parsed = JSON.parse(data.toString());
      messages.push(parsed);

      if (messageResolvers.length > 0) {
        const resolver = messageResolvers.shift()!;
        resolver(parsed);
      }
    } catch {
      // Ignore non-JSON messages
    }
  });

  ws.on('close', () => {
    connected = false;
  });

  ws.on('error', () => {
    connected = false;
  });

  return {
    isConnected: () => connected,

    send: (data: unknown) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    },

    waitForMessage: (timeoutMs = 5000): Promise<unknown> => {
      // Check if we already have a message
      if (messages.length > 0) {
        return Promise.resolve(messages.shift());
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const idx = messageResolvers.indexOf(resolve as (value: unknown) => void);
          if (idx >= 0) messageResolvers.splice(idx, 1);
          reject(new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`));
        }, timeoutMs);

        messageResolvers.push(value => {
          clearTimeout(timeout);
          resolve(value);
        });
      });
    },

    waitForConnection: (timeoutMs = 5000): Promise<void> => {
      if (connected) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const idx = connectionResolvers.indexOf(resolve);
          if (idx >= 0) connectionResolvers.splice(idx, 1);
          reject(new Error(`Timeout waiting for WebSocket connection after ${timeoutMs}ms`));
        }, timeoutMs);

        connectionResolvers.push(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },

    getMessages: () => [...messages],

    close: () => {
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
};
