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

describe('stopCapture wsFramesByRequestId cleanup', () => {
  test('clears wsFramesByRequestId entries when stopCapture is called without webSocketClosed', async () => {
    const tabId = 3101;
    await startCapture(tabId);

    // Simulate WebSocket open — stores requestId → url in wsFramesByRequestId
    capturedOnEventListener?.({ tabId }, 'Network.webSocketCreated', {
      requestId: 'ws-orphan-1',
      url: 'wss://example.com/live',
    });

    // A frame is captured, proving wsFramesByRequestId has the entry
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-orphan-1',
      response: { opcode: 1, payloadData: 'data', mask: false },
    });
    expect(getWsFrames(tabId, false)).toHaveLength(1);

    // Stop without firing webSocketClosed — orphaned entry must be cleaned up
    stopCapture(tabId);

    // After stopCapture, no frames are accessible (capture is gone)
    expect(getWsFrames(tabId, false)).toHaveLength(0);
  });
});

describe('periodic pruning interval', () => {
  test('prunes stale requestIdToRequest entries even when no new requests arrive', async () => {
    vi.useFakeTimers();
    const tabId = 4001;

    const chromeMock = (globalThis as Record<string, unknown>).chrome as {
      debugger: { sendCommand: ReturnType<typeof vi.fn> };
    };

    await startCapture(tabId);

    // responseReceived moves the pending entry into requestIdToRequest
    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-prune-1',
      request: { url: 'https://example.com/api', method: 'GET', headers: {} },
    });
    capturedOnEventListener?.({ tabId }, 'Network.responseReceived', {
      requestId: 'req-prune-1',
      response: {
        url: 'https://example.com/api',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
      },
    });
    // req-prune-1 is now in requestIdToRequest, waiting for loadingFinished

    // Advance time so the periodic interval fires three times;
    // the third tick (at +90 s) makes the entry older than PENDING_REQUEST_TTL_MS (60 s)
    vi.advanceTimersByTime(90_000);

    // Clear sendCommand call history so we can assert on the upcoming loadingFinished
    chromeMock.debugger.sendCommand.mockClear();

    // Fire loadingFinished — if the entry was pruned the handler returns early
    // without calling Network.getResponseBody
    capturedOnEventListener?.({ tabId }, 'Network.loadingFinished', { requestId: 'req-prune-1' });

    expect(chromeMock.debugger.sendCommand).not.toHaveBeenCalled();

    stopCapture(tabId);
    vi.useRealTimers();
  });

  test('clears the pruning interval when stopCapture is called', async () => {
    vi.useFakeTimers();
    const tabId = 4002;

    await startCapture(tabId);
    // One active timer: the pruning interval
    expect(vi.getTimerCount()).toBe(1);

    stopCapture(tabId);
    // Interval must be cleared — no active timers remain
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
  });
});

describe('wsFramesByRequestId pruning', () => {
  test('periodic prune interval removes wsFramesByRequestId entries older than WS_TTL_MS', async () => {
    vi.useFakeTimers();
    const tabId = 5001;
    await startCapture(tabId);

    // Simulate WebSocket creation — stores entry in wsFramesByRequestId and wsCreatedAt
    capturedOnEventListener?.({ tabId }, 'Network.webSocketCreated', {
      requestId: 'ws-stale-1',
      url: 'wss://example.com/ws',
    });

    // Verify the frame is captured while the entry is still active
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-stale-1',
      response: { opcode: 1, payloadData: 'before-prune', mask: false },
    });
    expect(getWsFrames(tabId, false)).toHaveLength(1);

    // Advance time past WS_TTL_MS (5 min = 300,000 ms) with at least one prune interval firing
    // after the TTL is exceeded. PRUNE_INTERVAL_MS = 30,000 ms, so advancing 330,000 ms ensures
    // an interval fires at t=330,000 when the entry is 330,000 ms old (> 300,000 ms TTL).
    vi.advanceTimersByTime(330_000);

    // The entry should now be pruned — a new frame event must be silently dropped
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-stale-1',
      response: { opcode: 1, payloadData: 'after-prune', mask: false },
    });
    expect(getWsFrames(tabId, false)).toHaveLength(1); // only the original frame remains

    stopCapture(tabId);
    vi.useRealTimers();
  });

  test('inline prune in requestWillBeSent removes stale wsFramesByRequestId entries', async () => {
    vi.useFakeTimers();
    const tabId = 5002;
    await startCapture(tabId);

    // Simulate WebSocket creation
    capturedOnEventListener?.({ tabId }, 'Network.webSocketCreated', {
      requestId: 'ws-stale-2',
      url: 'wss://example.com/live',
    });

    // Advance only the clock past WS_TTL_MS (5 min + 1 ms) without firing any interval timers
    vi.setSystemTime(Date.now() + 300_001);

    // Trigger the inline prune by sending a new HTTP request
    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-trigger-prune',
      request: { url: 'https://example.com/api', method: 'GET', headers: {} },
    });

    // The WebSocket entry should now be pruned — subsequent frame events are dropped
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-stale-2',
      response: { opcode: 1, payloadData: 'after-prune', mask: false },
    });
    expect(getWsFrames(tabId, false)).toHaveLength(0);

    stopCapture(tabId);
    vi.useRealTimers();
  });

  test('active WebSocket connections within WS_TTL_MS are not pruned by the periodic interval', async () => {
    vi.useFakeTimers();
    const tabId = 5003;
    await startCapture(tabId);

    capturedOnEventListener?.({ tabId }, 'Network.webSocketCreated', {
      requestId: 'ws-active-1',
      url: 'wss://example.com/active',
    });

    // Advance time less than WS_TTL_MS — entry should survive periodic pruning
    vi.advanceTimersByTime(240_000); // 4 minutes: 8 prune intervals, but entry is only 4 min old

    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-active-1',
      response: { opcode: 1, payloadData: 'still-alive', mask: false },
    });
    expect(getWsFrames(tabId, false)).toHaveLength(1);

    stopCapture(tabId);
    vi.useRealTimers();
  });
});

describe('concurrent startCapture guard', () => {
  test('second concurrent call waits for first and does not re-attach the debugger', async () => {
    const tabId = 6001;
    const chromeMock = (globalThis as Record<string, unknown>).chrome as {
      debugger: { attach: ReturnType<typeof vi.fn> };
    };
    chromeMock.debugger.attach.mockClear();

    // Fire both calls synchronously — the second sees pendingCaptures entry set by the first
    const call1 = startCapture(tabId);
    const call2 = startCapture(tabId);

    await Promise.all([call1, call2]);

    // attach should have been called exactly once (no double-attach)
    expect(chromeMock.debugger.attach).toHaveBeenCalledTimes(1);
    expect(isCapturing(tabId)).toBe(true);

    stopCapture(tabId);
  });

  test('non-racing call after capture is active still throws', async () => {
    const tabId = 6002;
    await startCapture(tabId);

    await expect(startCapture(tabId)).rejects.toThrow(`Network capture already active for tab ${tabId}`);

    stopCapture(tabId);
  });

  test('if first startCapture fails, second does not report the tab as capturing', async () => {
    const tabId = 6003;
    const chromeMock = (globalThis as Record<string, unknown>).chrome as {
      debugger: { attach: ReturnType<typeof vi.fn> };
    };
    chromeMock.debugger.attach.mockRejectedValueOnce(new Error('debugger attach failed'));

    const call1 = startCapture(tabId);
    const call2 = startCapture(tabId);

    const [result1, result2] = await Promise.allSettled([call1, call2]);

    expect(result1.status).toBe('rejected');
    expect(result2.status).toBe('rejected');
    expect(isCapturing(tabId)).toBe(false);
  });
});

describe('getRequests', () => {
  test('clear=true preserves in-flight pending requests so their responses appear in subsequent reads', async () => {
    const tabId = 1001;
    await startCapture(tabId);

    // Fire requestWillBeSent — request is now pending (no responseReceived yet)
    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-inflight',
      request: { url: 'https://example.com/api', method: 'GET', headers: {} },
    });

    // Clear the buffer — pendingRequests must NOT be cleared
    const firstRead = getRequests(tabId, true);
    expect(firstRead).toHaveLength(0);

    // Fire responseReceived for the still-tracked pending request
    capturedOnEventListener?.({ tabId }, 'Network.responseReceived', {
      requestId: 'req-inflight',
      response: {
        url: 'https://example.com/api',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
      },
    });

    // The in-flight request's response must appear — it was preserved through the clear
    const secondRead = getRequests(tabId, false);
    expect(secondRead).toHaveLength(1);
    expect(secondRead[0]).toHaveProperty('url', 'https://example.com/api');
    expect(secondRead[0]).toHaveProperty('status', 200);

    stopCapture(tabId);
  });

  test('clear=true removes only completed entries from requestIdToRequest, not in-flight ones', async () => {
    const tabId = 1002;
    await startCapture(tabId);

    // req-completed: goes through full requestWillBeSent → responseReceived cycle
    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-completed',
      request: { url: 'https://example.com/done', method: 'GET', headers: {} },
    });
    capturedOnEventListener?.({ tabId }, 'Network.responseReceived', {
      requestId: 'req-completed',
      response: { url: 'https://example.com/done', status: 200, statusText: 'OK', headers: {}, mimeType: 'text/plain' },
    });

    // req-pending: only requestWillBeSent so far (still in-flight)
    capturedOnEventListener?.({ tabId }, 'Network.requestWillBeSent', {
      requestId: 'req-pending',
      request: { url: 'https://example.com/pending', method: 'POST', headers: {} },
    });

    // Clear — completed request leaves the buffer; in-flight request stays in pendingRequests
    const firstRead = getRequests(tabId, true);
    expect(firstRead).toHaveLength(1);
    expect(firstRead[0]).toHaveProperty('url', 'https://example.com/done');

    // The in-flight request now receives its response — must still be captured
    capturedOnEventListener?.({ tabId }, 'Network.responseReceived', {
      requestId: 'req-pending',
      response: {
        url: 'https://example.com/pending',
        status: 201,
        statusText: 'Created',
        headers: {},
        mimeType: 'application/json',
      },
    });

    const secondRead = getRequests(tabId, false);
    expect(secondRead).toHaveLength(1);
    expect(secondRead[0]).toHaveProperty('url', 'https://example.com/pending');
    expect(secondRead[0]).toHaveProperty('status', 201);

    stopCapture(tabId);
  });
});

describe('getWsFrames clear=true', () => {
  test('clear=true preserves wsFramesByRequestId so existing connections continue to be captured', async () => {
    const tabId = 7001;
    await startCapture(tabId);

    // Simulate WebSocket creation
    capturedOnEventListener?.({ tabId }, 'Network.webSocketCreated', {
      requestId: 'ws-clear-1',
      url: 'wss://example.com/live',
    });

    // Capture a frame before clearing
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-clear-1',
      response: { opcode: 1, payloadData: 'before-clear', mask: false },
    });

    // Clear the frame buffer
    const firstRead = getWsFrames(tabId, true);
    expect(firstRead).toHaveLength(1);
    expect(firstRead[0]).toHaveProperty('data', 'before-clear');

    // Send another frame after clear — wsFramesByRequestId must still hold the entry
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameSent', {
      requestId: 'ws-clear-1',
      response: { opcode: 1, payloadData: 'after-clear', mask: false },
    });

    const secondRead = getWsFrames(tabId, false);
    expect(secondRead).toHaveLength(1);
    expect(secondRead[0]).toHaveProperty('data', 'after-clear');
    expect(secondRead[0]).toHaveProperty('direction', 'sent');

    stopCapture(tabId);
  });

  test('clear=true on multiple consecutive clears keeps the connection alive', async () => {
    const tabId = 7002;
    await startCapture(tabId);

    capturedOnEventListener?.({ tabId }, 'Network.webSocketCreated', {
      requestId: 'ws-clear-2',
      url: 'wss://example.com/stream',
    });

    // First frame, then clear
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-clear-2',
      response: { opcode: 1, payloadData: 'msg-1', mask: false },
    });
    expect(getWsFrames(tabId, true)).toHaveLength(1);

    // Second frame after first clear, then clear again
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-clear-2',
      response: { opcode: 1, payloadData: 'msg-2', mask: false },
    });
    expect(getWsFrames(tabId, true)).toHaveLength(1);

    // Third frame after second clear — connection is still alive
    capturedOnEventListener?.({ tabId }, 'Network.webSocketFrameReceived', {
      requestId: 'ws-clear-2',
      response: { opcode: 1, payloadData: 'msg-3', mask: false },
    });
    const finalRead = getWsFrames(tabId, false);
    expect(finalRead).toHaveLength(1);
    expect(finalRead[0]).toHaveProperty('data', 'msg-3');

    stopCapture(tabId);
  });
});
