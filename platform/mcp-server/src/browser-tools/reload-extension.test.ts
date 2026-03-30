import { describe, expect, test } from 'vitest';
import { createState } from '../state.js';
import { reloadExtension } from './reload-extension.js';

describe('reloadExtension handler', () => {
  test('returns error when no extension is connected', async () => {
    const state = createState();

    const result = await reloadExtension.handler({}, state);

    expect(result).toEqual({ ok: false, error: 'Extension not connected' });
  });

  test('sends JSON-RPC extension.reload notification and returns success', async () => {
    const state = createState();
    const sent: string[] = [];
    state.extensionConnections.set('test-conn', {
      ws: { send: (data: string) => sent.push(data), close: () => {} },
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const result = await reloadExtension.handler({}, state);

    expect(result).toEqual({ ok: true, message: 'Reload signal sent to extension' });
    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0] as string) as { jsonrpc: string; method: string; id?: unknown };
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('extension.reload');
    expect(msg.id).toBeUndefined();
  });

  test('returns error when all connections fail to send', async () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: {
        send: () => {
          throw new Error('ws closed');
        },
        close: () => {},
      },
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const result = await reloadExtension.handler({}, state);

    expect(result).toEqual({
      ok: false,
      error: 'Failed to send reload signal — extension may be disconnecting',
    });
  });

  test('sends a notification with no id field (fire-and-forget)', async () => {
    const state = createState();
    let captured = '';
    state.extensionConnections.set('test-conn', {
      ws: {
        send: (data: string) => {
          captured = data;
        },
        close: () => {},
      },
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    await reloadExtension.handler({}, state);

    const msg = JSON.parse(captured) as Record<string, unknown>;
    expect('id' in msg).toBe(false);
  });
});
