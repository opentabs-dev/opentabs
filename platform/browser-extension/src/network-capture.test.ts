import { describe, expect, vi, test } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API stubs — network-capture.ts registers listeners at module level
// ---------------------------------------------------------------------------

let capturedOnEventListener: ((source: { tabId?: number }, method: string, params?: object) => void) | undefined;
let capturedOnDetachListener: ((source: { tabId?: number }, reason: string) => void) | undefined;

(globalThis as Record<string, unknown>).chrome = {
  debugger: {
    onEvent: {
      addListener: vi.fn((cb: (source: { tabId?: number }, method: string, params?: object) => void) => {
        capturedOnEventListener = cb;
      }),
    },
    onDetach: {
      addListener: vi.fn((cb: (source: { tabId?: number }, reason: string) => void) => {
        capturedOnDetachListener = cb;
      }),
    },
    attach: vi.fn(() => Promise.resolve()),
    detach: vi.fn(() => Promise.resolve()),
    sendCommand: vi.fn(() => Promise.resolve()),
  },
  runtime: { lastError: undefined },
  tabs: { onRemoved: { addListener: vi.fn() } },
};

const { scrubHeaders, startCapture, isCapturing, stopCapture, getRequests, getWsFrames } =
  await import('./network-capture.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scrubHeaders', () => {
  test('returns undefined for undefined input', () => {
    expect(scrubHeaders(undefined)).toBeUndefined();
  });

  test('preserves non-sensitive headers', () => {
    const result = scrubHeaders({ 'Content-Type': 'application/json', Accept: 'text/html' });
    expect(result).toEqual({ 'Content-Type': 'application/json', Accept: 'text/html' });
  });

  describe('existing sensitive headers', () => {
    test('redacts authorization with scheme preserved', () => {
      const result = scrubHeaders({ Authorization: 'Bearer abc123' });
      expect(result).toEqual({ Authorization: 'Bearer [REDACTED]' });
    });

    test('redacts proxy-authorization with scheme preserved', () => {
      const result = scrubHeaders({ 'Proxy-Authorization': 'Basic dXNlcjpwYXNz' });
      expect(result).toEqual({ 'Proxy-Authorization': 'Basic [REDACTED]' });
    });

    test('redacts cookie', () => {
      const result = scrubHeaders({ Cookie: 'session=abc123' });
      expect(result).toEqual({ Cookie: '[REDACTED]' });
    });

    test('redacts set-cookie', () => {
      const result = scrubHeaders({ 'Set-Cookie': 'session=abc123; Path=/' });
      expect(result).toEqual({ 'Set-Cookie': '[REDACTED]' });
    });

    test('redacts x-csrf-token', () => {
      const result = scrubHeaders({ 'X-CSRF-Token': 'token123' });
      expect(result).toEqual({ 'X-CSRF-Token': '[REDACTED]' });
    });

    test('redacts x-xsrf-token', () => {
      const result = scrubHeaders({ 'X-XSRF-Token': 'token456' });
      expect(result).toEqual({ 'X-XSRF-Token': '[REDACTED]' });
    });
  });

  describe('newly added sensitive headers', () => {
    test('redacts x-api-key', () => {
      const result = scrubHeaders({ 'x-api-key': 'sk-abc123' });
      expect(result).toEqual({ 'x-api-key': '[REDACTED]' });
    });

    test('redacts X-Api-Key (mixed case)', () => {
      const result = scrubHeaders({ 'X-Api-Key': 'sk-abc123' });
      expect(result).toEqual({ 'X-Api-Key': '[REDACTED]' });
    });

    test('redacts x-auth-token', () => {
      const result = scrubHeaders({ 'X-Auth-Token': 'eyJhbG...' });
      expect(result).toEqual({ 'X-Auth-Token': '[REDACTED]' });
    });

    test('redacts x-access-token', () => {
      const result = scrubHeaders({ 'X-Access-Token': 'access_xyz' });
      expect(result).toEqual({ 'X-Access-Token': '[REDACTED]' });
    });

    test('redacts x-api-token', () => {
      const result = scrubHeaders({ 'x-api-token': 'tok_789' });
      expect(result).toEqual({ 'x-api-token': '[REDACTED]' });
    });

    test('redacts www-authenticate', () => {
      const result = scrubHeaders({ 'WWW-Authenticate': 'Bearer realm="api"' });
      expect(result).toEqual({ 'WWW-Authenticate': '[REDACTED]' });
    });
  });

  describe('case insensitivity', () => {
    test('redacts regardless of header name casing', () => {
      const result = scrubHeaders({
        'X-API-KEY': 'key1',
        'x-auth-TOKEN': 'key2',
        'X-Access-Token': 'key3',
      });
      expect(result).toEqual({
        'X-API-KEY': '[REDACTED]',
        'x-auth-TOKEN': '[REDACTED]',
        'X-Access-Token': '[REDACTED]',
      });
    });
  });

  describe('mixed headers', () => {
    test('redacts sensitive headers while preserving non-sensitive ones', () => {
      const result = scrubHeaders({
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
        'x-api-key': 'sk-test',
        'X-Request-Id': 'req-123',
        'x-auth-token': 'tok-abc',
      });
      expect(result).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer [REDACTED]',
        'x-api-key': '[REDACTED]',
        'X-Request-Id': 'req-123',
        'x-auth-token': '[REDACTED]',
      });
    });
  });
});

describe('onDetach handler', () => {
  test('cleans up capture state when the debugger is externally detached', async () => {
    const tabId = 9901;
    await startCapture(tabId);
    expect(isCapturing(tabId)).toBe(true);

    capturedOnDetachListener?.({ tabId }, 'canceled_by_user');

    expect(isCapturing(tabId)).toBe(false);
  });

  test('startCapture succeeds for the same tab after external detach', async () => {
    const tabId = 9902;
    await startCapture(tabId);

    capturedOnDetachListener?.({ tabId }, 'replaced_with_devtools');

    // Must not throw 'Network capture already active'
    await expect(startCapture(tabId)).resolves.toBeUndefined();
    stopCapture(tabId);
  });

  test('does not call chrome.debugger.detach (debugger is already gone)', async () => {
    const tabId = 9903;
    await startCapture(tabId);
    const chromeMock = (globalThis as Record<string, unknown>).chrome as {
      debugger: { detach: ReturnType<typeof vi.fn> };
    };
    const detachMock = chromeMock.debugger.detach;
    detachMock.mockClear();

    capturedOnDetachListener?.({ tabId }, 'target_closed');

    expect(detachMock).not.toHaveBeenCalled();
  });

  test('is a no-op for tabs not in captures', () => {
    const tabId = 9904;
    expect(() => capturedOnDetachListener?.({ tabId }, 'target_closed')).not.toThrow();
    expect(isCapturing(tabId)).toBe(false);
  });
});

describe('Network.loadingFinished', () => {
  test('sets responseBody on request still in buffer', async () => {
    const tabId = 2001;
    await startCapture(tabId);

    const chromeMock = (globalThis as Record<string, unknown>).chrome as {
      debugger: { sendCommand: ReturnType<typeof vi.fn> };
    };

    // Mock sendCommand to capture the callback so we can invoke it synchronously
    let capturedBodyCallback: ((result: unknown) => void) | undefined;
    chromeMock.debugger.sendCommand.mockImplementationOnce(
      (_target: unknown, _method: unknown, _params: unknown, callback?: (result: unknown) => void) => {
        capturedBodyCallback = callback;
      },
    );

    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-body-1',
      request: { url: 'https://example.com/api', method: 'GET', headers: {} },
    });
    capturedOnEventListener?.({ tabId }, 'Network.responseReceived', {
      requestId: 'req-body-1',
      response: { url: 'https://example.com/api', status: 200, statusText: 'OK', headers: {}, mimeType: 'text/plain' },
    });
    capturedOnEventListener?.({ tabId }, 'Network.loadingFinished', { requestId: 'req-body-1' });

    // Invoke callback before reading — spread in getRequests will capture the written body
    capturedBodyCallback?.({ body: 'hello world', base64Encoded: false });

    const requests = getRequests(tabId, false);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveProperty('responseBody', 'hello world');

    stopCapture(tabId);
  });

  test('does not write responseBody to a request evicted from the buffer', async () => {
    const tabId = 2002;
    // maxRequests=1 so that when req-2 arrives, req-1 is evicted
    await startCapture(tabId, 1);

    const chromeMock = (globalThis as Record<string, unknown>).chrome as {
      debugger: { sendCommand: ReturnType<typeof vi.fn> };
    };

    // Capture the body callback for req-1's loadingFinished
    let capturedBodyCallback: ((result: unknown) => void) | undefined;
    chromeMock.debugger.sendCommand.mockImplementationOnce(
      (_target: unknown, _method: unknown, _params: unknown, callback?: (result: unknown) => void) => {
        capturedBodyCallback = callback;
      },
    );

    // req-1: enters buffer (buffer: [req-1])
    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-evict-1',
      request: { url: 'https://example.com/r1', method: 'GET', headers: {} },
    });
    capturedOnEventListener?.({ tabId }, 'Network.responseReceived', {
      requestId: 'req-evict-1',
      response: { url: 'https://example.com/r1', status: 200, statusText: 'OK', headers: {}, mimeType: 'text/plain' },
    });
    // loadingFinished for req-1: deletes from requestIdToRequest, defers body fetch
    capturedOnEventListener?.({ tabId }, 'Network.loadingFinished', { requestId: 'req-evict-1' });
    expect(capturedBodyCallback).toBeDefined();

    // req-2: buffer at capacity — evicts req-1; buffer is now [req-2]
    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-evict-2',
      request: { url: 'https://example.com/r2', method: 'GET', headers: {} },
    });
    capturedOnEventListener?.({ tabId }, 'Network.responseReceived', {
      requestId: 'req-evict-2',
      response: { url: 'https://example.com/r2', status: 200, statusText: 'OK', headers: {}, mimeType: 'text/plain' },
    });

    // Invoke the deferred callback for the evicted req-1 — guard must discard the write
    capturedBodyCallback?.({ body: 'evicted-body', base64Encoded: false });

    // Buffer should contain only req-2; req-1's deferred body write was discarded
    const requests = getRequests(tabId, false);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveProperty('url', 'https://example.com/r2');
    expect(requests[0]).not.toHaveProperty('responseBody');

    stopCapture(tabId);
  });
});

describe('Network.webSocketClosed', () => {
  test('deletes the requestId entry from wsFramesByRequestId on close', async () => {
    const tabId = 3001;
    await startCapture(tabId);

    // Simulate WebSocket open — stores requestId → url in wsFramesByRequestId
    capturedOnEventListener?.({ tabId }, 'Network.webSocketCreated', {
      requestId: 'ws-req-1',
      url: 'wss://example.com/ws',
    });

    // A frame received before close should be captured
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-req-1',
      response: { opcode: 1, payloadData: 'hello', mask: false },
    });
    expect(getWsFrames(tabId, false)).toHaveLength(1);

    // Close the WebSocket — should remove the entry from wsFramesByRequestId
    capturedOnEventListener?.({ tabId }, 'Network.webSocketClosed', {
      requestId: 'ws-req-1',
    });

    // Frames received after close (stale events) must not be stored
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-req-1',
      response: { opcode: 1, payloadData: 'after-close', mask: false },
    });
    expect(getWsFrames(tabId, false)).toHaveLength(1);

    stopCapture(tabId);
  });

  test('is a no-op when requestId is missing from params', async () => {
    const tabId = 3002;
    await startCapture(tabId);

    // Should not throw even if requestId is absent
    expect(() => capturedOnEventListener?.({ tabId }, 'Network.webSocketClosed', {})).not.toThrow();

    stopCapture(tabId);
  });
});

describe('getRequests', () => {
  test('clear=true discards in-flight pending requests so they do not appear in subsequent reads', async () => {
    const tabId = 1001;
    await startCapture(tabId);

    // Fire requestWillBeSent — request is now pending (no responseReceived yet)
    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-stale',
      request: { url: 'https://example.com/api', method: 'GET', headers: {} },
    });

    // Clear the buffer — pendingRequests must also be cleared
    const firstRead = getRequests(tabId, true);
    expect(firstRead).toHaveLength(0);

    // Fire responseReceived for the now-discarded pending request
    capturedOnEventListener?.({ tabId }, 'Network.responseReceived', {
      requestId: 'req-stale',
      response: {
        url: 'https://example.com/api',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
      },
    });

    // The stale pending request must not appear — the clear already discarded it
    const secondRead = getRequests(tabId, false);
    expect(secondRead).toHaveLength(0);

    stopCapture(tabId);
  });
});
