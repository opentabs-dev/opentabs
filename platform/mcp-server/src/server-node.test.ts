import { connect as netConnect } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { createNodeServer, type NodeServer, type NodeServerOptions } from './server-node.js';

/**
 * Tests for the Node.js WebSocket upgrade path.
 *
 * Focus: a route handler that declines an upgrade by returning an HTTP Response
 * (e.g. 401 on failed auth) must have that response written to the raw upgrade
 * socket — not have the socket silently destroyed. A silent destroy is
 * indistinguishable from "server unreachable" to the client, which masks auth
 * failures behind an endless reconnect loop.
 */

const SECRET = 'a1b2c3d4e5f6';

/**
 * Build server options whose fetch handler mimics the real /ws upgrade auth
 * check: it upgrades only when the client offers the secret as a subprotocol,
 * otherwise returns 401 without requesting an upgrade.
 */
const buildOptions = (overrides?: Partial<NodeServerOptions>): NodeServerOptions => ({
  hostname: '127.0.0.1',
  port: 0,
  fetch: async (req, server): Promise<Response | undefined> => {
    const url = new URL(req.url);
    if (url.pathname !== '/ws') return new Response('Not Found', { status: 404 });

    const parts = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map(p => p.trim());
    if (!parts.includes(SECRET)) {
      return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    }
    server.upgrade(req, { data: undefined, headers: { 'sec-websocket-protocol': 'opentabs' } });
    return undefined;
  },
  websocket: {
    open: ws => ws.send(JSON.stringify({ method: 'hello' })),
    message: () => {},
    close: () => {},
  },
  ...overrides,
});

/** Perform a raw HTTP/1.1 WebSocket upgrade request and capture the status line. */
const rawUpgrade = (port: number, protocolHeader: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const sock = netConnect(port, '127.0.0.1', () => {
      sock.write(
        [
          'GET /ws HTTP/1.1',
          `Host: 127.0.0.1:${port.toString()}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          `Sec-WebSocket-Protocol: ${protocolHeader}`,
          '',
          '',
        ].join('\r\n'),
      );
    });
    let buf = '';
    sock.on('data', d => {
      buf += d.toString('latin1');
      if (buf.includes('\r\n\r\n')) {
        sock.destroy();
        resolve(buf.split('\r\n\r\n')[0] ?? buf);
      }
    });
    sock.on('error', reject);
    sock.on('close', () => {
      // Resolve with whatever was received if the socket closed without a full header block.
      if (!buf.includes('\r\n\r\n')) resolve(buf);
    });
    setTimeout(() => {
      sock.destroy();
      reject(new Error('timeout waiting for upgrade response'));
    }, 3_000);
  });

describe('server-node WebSocket upgrade', () => {
  let server: NodeServer | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
  });

  test('accepts an upgrade when the client offers the secret', async () => {
    server = await createNodeServer(buildOptions());
    const ws = new WebSocket(`ws://127.0.0.1:${server.port.toString()}/ws`, ['opentabs', SECRET]);

    const firstMessage = await new Promise<string>((resolve, reject) => {
      ws.on('message', data => resolve(data.toString('utf-8')));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('no message received')), 3_000);
    });

    expect(ws.protocol).toBe('opentabs');
    expect(JSON.parse(firstMessage)).toEqual({ method: 'hello' });
    ws.close();
  });

  test('writes a 401 HTTP response when the upgrade is declined for auth', async () => {
    server = await createNodeServer(buildOptions());
    const statusBlock = await rawUpgrade(server.port, 'opentabs');

    expect(statusBlock).toContain('HTTP/1.1 401 Unauthorized');
    // Header names are case-insensitive; the Web Headers API lowercases them.
    expect(statusBlock.toLowerCase()).toContain('www-authenticate: bearer');
    expect(statusBlock).toContain('Connection: close');
  });

  test('a declined upgrade surfaces as an error to a ws client, not a hang', async () => {
    server = await createNodeServer(buildOptions());
    const ws = new WebSocket(`ws://127.0.0.1:${server.port.toString()}/ws`, ['opentabs', 'wrong-secret']);

    const outcome = await new Promise<'open' | 'error'>(resolve => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('error'));
      setTimeout(() => resolve('open'), 3_000); // treat a hang as a (failing) "open"
    });

    expect(outcome).toBe('error');
  });
});
