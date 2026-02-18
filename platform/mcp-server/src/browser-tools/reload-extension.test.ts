import { reloadExtension } from './reload-extension.js';
import { createState } from '../state.js';
import { describe, expect, test } from 'bun:test';

describe('reloadExtension handler', () => {
  test('returns error when extensionWs is null', async () => {
    const state = createState();
    state.extensionWs = null;

    const result = await reloadExtension.handler({}, state);

    expect(result).toEqual({ ok: false, error: 'Extension not connected' });
  });

  test('sends JSON-RPC extension.reload message and returns success', async () => {
    const state = createState();
    const sent: string[] = [];
    state.extensionWs = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    const result = await reloadExtension.handler({}, state);

    expect(result).toEqual({ ok: true, message: 'Reload signal sent to extension' });
    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0] as string) as { jsonrpc: string; method: string; id: string };
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('extension.reload');
    expect(typeof msg.id).toBe('string');
  });

  test('returns error when ws.send throws', async () => {
    const state = createState();
    state.extensionWs = {
      send: () => {
        throw new Error('ws closed');
      },
      close: () => {},
    };

    const result = await reloadExtension.handler({}, state);

    expect(result).toEqual({
      ok: false,
      error: 'Failed to send reload signal — extension may be disconnecting',
    });
  });

  test('uses a UUID string id from getNextRequestId in the message', async () => {
    const state = createState();
    let captured = '';
    state.extensionWs = {
      send: (data: string) => {
        captured = data;
      },
      close: () => {},
    };

    await reloadExtension.handler({}, state);

    const msg = JSON.parse(captured) as { id: string };
    expect(typeof msg.id).toBe('string');
    expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
