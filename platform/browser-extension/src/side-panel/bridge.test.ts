import { fetchConfigState, handleServerResponse, rejectAllPending, setToolEnabled } from './bridge.js';
import { beforeEach, describe, expect, test } from 'bun:test';

/** Captured sendMessage calls. Each entry has the message object passed to sendMessage. */
let sendMessageCalls: Array<{ message: unknown }> = [];

/**
 * When set, chrome.runtime.sendMessage will reject with this error on the next call.
 * Cleared after each call.
 */
let nextSendError: { message: string } | null = null;

beforeEach(() => {
  sendMessageCalls = [];
  nextSendError = null;

  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage: (message: unknown) => {
        sendMessageCalls.push({ message });

        if (nextSendError) {
          const err = new Error(nextSendError.message);
          nextSendError = null;
          return Promise.reject(err);
        }

        return Promise.resolve();
      },
    },
  };
});

/** Extract the JSON-RPC id from the most recent sendMessage call */
const getLastRequestId = (): string => {
  const last = sendMessageCalls.at(-1);
  if (!last) throw new Error('No sendMessage calls captured');
  const data = (last.message as { data: { id: string } }).data;
  return data.id;
};

/**
 * Reject all pending requests and suppress the unhandled rejections.
 * Used at the end of tests that create pending requests without resolving them.
 */
const cleanupPending = (...promises: Promise<unknown>[]): void => {
  rejectAllPending();
  for (const p of promises) {
    p.catch(() => {});
  }
};

/** Assert that a promise rejects with an error containing the given message */
const expectRejection = async (promise: Promise<unknown>, message: string): Promise<void> => {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(message);
  }
};

describe('handleServerResponse', () => {
  test('returns true and resolves promise for matching response id', async () => {
    const promise = fetchConfigState();
    const id = getLastRequestId();

    const payload = { plugins: ['stub-plugin'], outdatedPlugins: [] };
    const handled = handleServerResponse({ id, result: payload });

    expect(handled).toBe(true);
    const result = (await promise) as unknown as Record<string, unknown>;
    expect(result.plugins).toEqual(payload.plugins);
  });

  test('returns false for messages with a method field (notifications)', () => {
    const handled = handleServerResponse({ method: 'plugins.changed', params: {} });
    expect(handled).toBe(false);
  });

  test('returns false for messages with both id and method (request-shaped)', async () => {
    const promise = fetchConfigState();
    const id = getLastRequestId();

    const handled = handleServerResponse({ id, method: 'some.method', result: {} });
    expect(handled).toBe(false);

    handleServerResponse({ id, result: { plugins: [], outdatedPlugins: [] } });
    await promise;
  });

  test('returns false for unknown ids', () => {
    const handled = handleServerResponse({ id: 'nonexistent-id', result: {} });
    expect(handled).toBe(false);
  });

  test('returns false for undefined id', () => {
    const handled = handleServerResponse({ result: {} });
    expect(handled).toBe(false);
  });

  test('returns false for null id', () => {
    const handled = handleServerResponse({ id: null, result: {} });
    expect(handled).toBe(false);
  });

  test('handles numeric id by converting to string', async () => {
    const promise = fetchConfigState();
    const id = getLastRequestId();

    // Pending map keys are string UUIDs, so a numeric id won't match
    const handled = handleServerResponse({ id: 42, result: {} });
    expect(handled).toBe(false);

    handleServerResponse({ id, result: { plugins: [], outdatedPlugins: [] } });
    await promise;
  });

  test('rejects promise for server error responses', async () => {
    const promise = fetchConfigState();
    const id = getLastRequestId();

    handleServerResponse({ id, error: { message: 'Plugin not found' } });

    await expectRejection(promise, 'Plugin not found');
  });

  test('rejects with generic message for error without message field', async () => {
    const promise = fetchConfigState();
    const id = getLastRequestId();

    handleServerResponse({ id, error: {} });

    await expectRejection(promise, 'Unknown server error');
  });

  test('resolves multiple concurrent requests independently', async () => {
    const p1 = setToolEnabled('slack', 'send-message', true);
    const id1 = getLastRequestId();

    const p2 = setToolEnabled('slack', 'list-channels', false);
    const id2 = getLastRequestId();

    // Resolve in reverse order
    handleServerResponse({ id: id2, result: { ok: true, tool: 'list-channels' } });
    handleServerResponse({ id: id1, result: { ok: true, tool: 'send-message' } });

    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toEqual({ ok: true, tool: 'send-message' });
    expect(r2).toEqual({ ok: true, tool: 'list-channels' });
  });
});

describe('rejectAllPending', () => {
  test('rejects all inflight requests with Server disconnected', async () => {
    const p1 = fetchConfigState();
    const p2 = setToolEnabled('slack', 'send-message', true);

    rejectAllPending();

    await expectRejection(p1, 'Server disconnected');
    await expectRejection(p2, 'Server disconnected');
  });

  test('clears pending request timers (no timeout after reject)', async () => {
    const promise = fetchConfigState();
    rejectAllPending();

    await expectRejection(promise, 'Server disconnected');

    // After rejectAllPending, handleServerResponse with the same id returns false
    // (the entry was removed from the map)
    const id = getLastRequestId();
    const handled = handleServerResponse({ id, result: {} });
    expect(handled).toBe(false);
  });

  test('is a no-op when no requests are pending', () => {
    rejectAllPending();
  });
});

describe('sendRequest error handling', () => {
  test('rejects when sendMessage rejects', async () => {
    nextSendError = { message: 'Extension context invalidated.' };

    const promise = fetchConfigState();

    await expectRejection(promise, 'Extension context invalidated.');
  });

  test('sends correct JSON-RPC message format', () => {
    const promise = setToolEnabled('slack', 'send-message', true);

    expect(sendMessageCalls).toHaveLength(1);
    const entry = sendMessageCalls.at(0);
    if (!entry) throw new Error('Expected sendMessage call');
    const msg = entry.message as { type: string; data: Record<string, unknown> };

    expect(msg.type).toBe('bg:send');
    expect(msg.data.jsonrpc).toBe('2.0');
    expect(msg.data.method).toBe('config.setToolEnabled');
    expect(msg.data.params).toEqual({ plugin: 'slack', tool: 'send-message', enabled: true });
    expect(typeof msg.data.id).toBe('string');

    cleanupPending(promise);
  });
});

describe('getConnectionState', () => {
  test('resolves true when background reports connected', async () => {
    (chrome.runtime as Record<string, unknown>).sendMessage = (
      message: unknown,
      callback: (response: unknown) => void,
    ) => {
      sendMessageCalls.push({ message });
      (chrome.runtime as Record<string, unknown>).lastError = undefined;
      callback({ connected: true });
    };

    const { getConnectionState } = await import('./bridge.js');
    const result = await getConnectionState();
    expect(result).toBe(true);
  });

  test('resolves false when background reports disconnected', async () => {
    (chrome.runtime as Record<string, unknown>).sendMessage = (
      message: unknown,
      callback: (response: unknown) => void,
    ) => {
      sendMessageCalls.push({ message });
      (chrome.runtime as Record<string, unknown>).lastError = undefined;
      callback({ connected: false });
    };

    const { getConnectionState } = await import('./bridge.js');
    const result = await getConnectionState();
    expect(result).toBe(false);
  });

  test('resolves false when chrome.runtime.lastError is set', async () => {
    (chrome.runtime as Record<string, unknown>).sendMessage = (
      message: unknown,
      callback: (response: unknown) => void,
    ) => {
      sendMessageCalls.push({ message });
      (chrome.runtime as Record<string, unknown>).lastError = { message: 'error' };
      callback(undefined);
    };

    const { getConnectionState } = await import('./bridge.js');
    const result = await getConnectionState();
    expect(result).toBe(false);
  });
});
