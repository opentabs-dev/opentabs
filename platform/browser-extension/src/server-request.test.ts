import { vi, describe, expect, test, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { mockSendToServer } = vi.hoisted(() => ({
  mockSendToServer: vi.fn<(data: unknown) => void>(),
}));

vi.mock('./messaging.js', () => ({
  sendToServer: mockSendToServer,
}));

const { sendServerRequest, consumeServerResponse, rejectAllPendingServerRequests } =
  await import('./server-request.js');

beforeEach(() => {
  vi.clearAllMocks();
  // Reject any leftover pending requests from previous tests
  rejectAllPendingServerRequests();
});

// ---------------------------------------------------------------------------
// sendServerRequest
// ---------------------------------------------------------------------------

describe('sendServerRequest', () => {
  test('sends a JSON-RPC message via sendToServer with incrementing integer id', () => {
    // Fire two requests — catch rejections from cleanup
    const p1 = sendServerRequest('config.setToolEnabled', { plugin: 'slack', tool: 'send', enabled: true });
    const p2 = sendServerRequest('config.setBrowserToolEnabled', { tool: 'screenshot', enabled: false });
    p1.catch(() => {});
    p2.catch(() => {});

    expect(mockSendToServer).toHaveBeenCalledTimes(2);

    const first = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const second = mockSendToServer.mock.calls[1]?.[0] as Record<string, unknown>;

    expect(first).toMatchObject({
      jsonrpc: '2.0',
      method: 'config.setToolEnabled',
      params: { plugin: 'slack', tool: 'send', enabled: true },
    });
    expect(typeof first.id).toBe('number');

    expect(second).toMatchObject({
      jsonrpc: '2.0',
      method: 'config.setBrowserToolEnabled',
      params: { tool: 'screenshot', enabled: false },
    });
    expect(typeof second.id).toBe('number');

    // IDs should be different
    expect(first.id).not.toBe(second.id);

    // Clean up
    rejectAllPendingServerRequests();
  });

  test('resolves when consumeServerResponse receives a matching result', async () => {
    const promise = sendServerRequest('config.getState');

    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const requestId = sentData.id as number;

    const consumed = consumeServerResponse({
      jsonrpc: '2.0',
      result: { plugins: [] },
      id: requestId,
    });

    expect(consumed).toBe(true);
    await expect(promise).resolves.toEqual({ plugins: [] });
  });

  test('rejects when consumeServerResponse receives a matching error', async () => {
    const promise = sendServerRequest('config.setToolEnabled', { plugin: 'x', tool: 'y', enabled: true });

    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const requestId = sentData.id as number;

    const consumed = consumeServerResponse({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid request' },
      id: requestId,
    });

    expect(consumed).toBe(true);
    await expect(promise).rejects.toThrow('Invalid request');
  });

  test('rejects with default message when error has no message field', async () => {
    const promise = sendServerRequest('test.method');

    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const requestId = sentData.id as number;

    consumeServerResponse({
      jsonrpc: '2.0',
      error: { code: -32600 },
      id: requestId,
    });

    await expect(promise).rejects.toThrow('Unknown server error');
  });

  test('times out after 30 seconds', async () => {
    vi.useFakeTimers();
    try {
      const promise = sendServerRequest('slow.method');

      vi.advanceTimersByTime(30_000);

      await expect(promise).rejects.toThrow('Request slow.method timed out after 30000ms');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// consumeServerResponse
// ---------------------------------------------------------------------------

describe('consumeServerResponse', () => {
  test('returns false for messages with a method (notifications)', () => {
    expect(consumeServerResponse({ jsonrpc: '2.0', method: 'plugins.changed', params: {} })).toBe(false);
  });

  test('returns false for messages without id', () => {
    expect(consumeServerResponse({ jsonrpc: '2.0', result: {} })).toBe(false);
  });

  test('returns false for messages with null id', () => {
    expect(consumeServerResponse({ jsonrpc: '2.0', result: {}, id: null })).toBe(false);
  });

  test('returns false for messages with string id (our requests use integer ids)', () => {
    expect(consumeServerResponse({ jsonrpc: '2.0', result: {}, id: 'string-id' })).toBe(false);
  });

  test('returns false for unmatched numeric id', () => {
    expect(consumeServerResponse({ jsonrpc: '2.0', result: {}, id: 999999 })).toBe(false);
  });

  test('returns true and resolves the matching pending request', async () => {
    const promise = sendServerRequest('test.method');
    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const requestId = sentData.id as number;

    const consumed = consumeServerResponse({ jsonrpc: '2.0', result: 'hello', id: requestId });

    expect(consumed).toBe(true);
    await expect(promise).resolves.toBe('hello');
  });

  test('can only consume a response once', async () => {
    const promise = sendServerRequest('test.method');
    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const requestId = sentData.id as number;

    expect(consumeServerResponse({ jsonrpc: '2.0', result: 'first', id: requestId })).toBe(true);
    expect(consumeServerResponse({ jsonrpc: '2.0', result: 'second', id: requestId })).toBe(false);

    await expect(promise).resolves.toBe('first');
  });

  test('resolves (not rejects) when error key is present but undefined', async () => {
    const promise = sendServerRequest('test.method');
    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const requestId = sentData.id as number;

    const consumed = consumeServerResponse({ jsonrpc: '2.0', error: undefined, result: 'ok', id: requestId });

    expect(consumed).toBe(true);
    await expect(promise).resolves.toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// rejectAllPendingServerRequests
// ---------------------------------------------------------------------------

describe('rejectAllPendingServerRequests', () => {
  test('rejects all pending requests with "Server disconnected"', async () => {
    const p1 = sendServerRequest('method.a');
    const p2 = sendServerRequest('method.b');

    rejectAllPendingServerRequests();

    await expect(p1).rejects.toThrow('Server disconnected');
    await expect(p2).rejects.toThrow('Server disconnected');
  });

  test('clears the pending map so subsequent responses are not consumed', () => {
    void sendServerRequest('method.a').catch(() => {});
    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const requestId = sentData.id as number;

    rejectAllPendingServerRequests();

    // Response for the rejected request should not be consumed
    expect(consumeServerResponse({ jsonrpc: '2.0', result: {}, id: requestId })).toBe(false);
  });

  test('is safe to call when no requests are pending', () => {
    expect(() => rejectAllPendingServerRequests()).not.toThrow();
  });
});
