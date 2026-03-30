import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockDispatchToExtension } = vi.hoisted(() => ({
  mockDispatchToExtension:
    vi.fn<(state: unknown, method: string, params: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('../extension-protocol.js', () => ({
  dispatchToExtension: mockDispatchToExtension,
}));

import type { ExtensionConnection } from '../state.js';

const { exportHar } = await import('./export-har.js');
const { createState } = await import('../state.js');

/** Create a state with a mock connection pre-configured, returning both state and connection */
const createConnectedState = () => {
  const state = createState();
  const conn: ExtensionConnection = {
    ws: { send() {}, close() {} },
    connectionId: 'test-conn',
    profileLabel: 'test-conn',
    tabMapping: new Map(),
    activeNetworkCaptures: new Set(),
  };
  state.extensionConnections.set('test-conn', conn);
  return { state, conn };
};

describe('exportHar clear-after-fetch ordering', () => {
  beforeEach(() => {
    mockDispatchToExtension.mockReset();
  });

  test('HTTP request buffer is not cleared when WebSocket frame fetch fails', async () => {
    const { state, conn } = createConnectedState();
    conn.activeNetworkCaptures.add(10);

    const request = { url: 'https://example.com', method: 'GET', timestamp: 1000 };
    // First call: getNetworkRequests fetch (no clear) — succeeds
    mockDispatchToExtension.mockResolvedValueOnce([request]);
    // Second call: getWebSocketFrames fetch (no clear) — fails
    mockDispatchToExtension.mockRejectedValueOnce(new Error('WebSocket fetch failed'));

    await expect(exportHar.handler({ tabId: 10, clear: true, includeWebSocketFrames: true }, state)).rejects.toThrow(
      'WebSocket fetch failed',
    );

    // Only two dispatches should have been made (the two fetches) — no clear dispatches
    expect(mockDispatchToExtension).toHaveBeenCalledTimes(2);
    expect(mockDispatchToExtension).not.toHaveBeenCalledWith(
      expect.anything(),
      'browser.getNetworkRequests',
      expect.objectContaining({ clear: true }),
    );
  });

  test('both buffers are cleared after all fetches succeed when clear: true with WebSocket frames', async () => {
    const { state, conn } = createConnectedState();
    conn.activeNetworkCaptures.add(11);

    const request = { url: 'https://example.com', method: 'GET', timestamp: 1000 };
    mockDispatchToExtension.mockResolvedValueOnce([request]); // getNetworkRequests fetch
    mockDispatchToExtension.mockResolvedValueOnce({ frames: [] }); // getWebSocketFrames fetch
    mockDispatchToExtension.mockResolvedValueOnce([]); // getNetworkRequests clear
    mockDispatchToExtension.mockResolvedValueOnce({ frames: [] }); // getWebSocketFrames clear

    await exportHar.handler({ tabId: 11, clear: true, includeWebSocketFrames: true }, state);

    expect(mockDispatchToExtension).toHaveBeenCalledTimes(4);
    expect(mockDispatchToExtension).toHaveBeenNthCalledWith(1, expect.anything(), 'browser.getNetworkRequests', {
      tabId: 11,
    });
    expect(mockDispatchToExtension).toHaveBeenNthCalledWith(2, expect.anything(), 'browser.getWebSocketFrames', {
      tabId: 11,
    });
    expect(mockDispatchToExtension).toHaveBeenNthCalledWith(3, expect.anything(), 'browser.getNetworkRequests', {
      tabId: 11,
      clear: true,
    });
    expect(mockDispatchToExtension).toHaveBeenNthCalledWith(4, expect.anything(), 'browser.getWebSocketFrames', {
      tabId: 11,
      clear: true,
    });
  });

  test('entries are not wiped when WebSocket clear fetch fails after HTTP clear succeeds', async () => {
    const { state, conn } = createConnectedState();
    conn.activeNetworkCaptures.add(13);

    const request = { url: 'https://example.com', method: 'GET', timestamp: 1000 };
    const wsFrame = { url: 'wss://example.com', direction: 'received', data: 'hello', opcode: 1, timestamp: 2000 };

    mockDispatchToExtension.mockResolvedValueOnce([request]); // getNetworkRequests fetch
    mockDispatchToExtension.mockResolvedValueOnce({ frames: [wsFrame] }); // getWebSocketFrames fetch
    mockDispatchToExtension.mockResolvedValueOnce([request]); // getNetworkRequests clear
    mockDispatchToExtension.mockRejectedValueOnce(new Error('WS clear failed')); // getWebSocketFrames clear

    await expect(exportHar.handler({ tabId: 13, clear: true, includeWebSocketFrames: true }, state)).rejects.toThrow(
      'WS clear failed',
    );

    // All four dispatches were made (both non-clearing and both clearing fetches)
    expect(mockDispatchToExtension).toHaveBeenCalledTimes(4);
  });

  test('HTTP buffer is cleared after fetch succeeds when clear: true without WebSocket frames', async () => {
    const { state, conn } = createConnectedState();
    conn.activeNetworkCaptures.add(12);

    const request = { url: 'https://example.com', method: 'GET', timestamp: 1000 };
    mockDispatchToExtension.mockResolvedValueOnce([request]); // fetch without clear
    mockDispatchToExtension.mockResolvedValueOnce([]); // clear

    await exportHar.handler({ tabId: 12, clear: true }, state);

    expect(mockDispatchToExtension).toHaveBeenCalledTimes(2);
    expect(mockDispatchToExtension).toHaveBeenNthCalledWith(1, expect.anything(), 'browser.getNetworkRequests', {
      tabId: 12,
    });
    expect(mockDispatchToExtension).toHaveBeenNthCalledWith(2, expect.anything(), 'browser.getNetworkRequests', {
      tabId: 12,
      clear: true,
    });
  });
});

describe('exportHar HAR body size fields', () => {
  beforeEach(() => {
    mockDispatchToExtension.mockReset();
  });

  test('non-ASCII request and response bodies use byte length, not string length', async () => {
    const { state, conn } = createConnectedState();
    conn.activeNetworkCaptures.add(1);

    // '😀' is 2 JS chars (surrogate pair) but 4 bytes in UTF-8
    const emoji = '😀';
    expect(emoji.length).toBe(2);
    expect(Buffer.byteLength(emoji, 'utf-8')).toBe(4);

    const request = {
      url: 'https://example.com/api',
      method: 'POST',
      status: 200,
      statusText: 'OK',
      requestBody: emoji,
      responseBody: emoji,
      timestamp: 1000,
    };

    mockDispatchToExtension.mockResolvedValueOnce([request]);

    const result = await exportHar.handler({ tabId: 1 }, state);
    const har = JSON.parse((result as { har: string }).har) as {
      log: { entries: { request: { bodySize: number }; response: { content: { size: number }; bodySize: number } }[] };
    };

    const entry = har.log.entries[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.request.bodySize).toBe(4);
    expect(entry.response.content.size).toBe(4);
    expect(entry.response.bodySize).toBe(4);
  });

  test('ASCII request and response bodies produce the same size as string.length', async () => {
    const { state, conn } = createConnectedState();
    conn.activeNetworkCaptures.add(2);

    const ascii = 'hello world';
    expect(ascii.length).toBe(11);
    expect(Buffer.byteLength(ascii, 'utf-8')).toBe(11);

    const request = {
      url: 'https://example.com/api',
      method: 'POST',
      status: 200,
      statusText: 'OK',
      requestBody: ascii,
      responseBody: ascii,
      timestamp: 2000,
    };

    mockDispatchToExtension.mockResolvedValueOnce([request]);

    const result = await exportHar.handler({ tabId: 2 }, state);
    const har = JSON.parse((result as { har: string }).har) as {
      log: { entries: { request: { bodySize: number }; response: { content: { size: number }; bodySize: number } }[] };
    };

    const entry = har.log.entries[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.request.bodySize).toBe(11);
    expect(entry.response.content.size).toBe(11);
    expect(entry.response.bodySize).toBe(11);
  });

  test('absent request body uses 0 and absent response body uses -1', async () => {
    const { state, conn } = createConnectedState();
    conn.activeNetworkCaptures.add(3);

    const request = {
      url: 'https://example.com/api',
      method: 'GET',
      status: 200,
      statusText: 'OK',
      timestamp: 3000,
    };

    mockDispatchToExtension.mockResolvedValueOnce([request]);

    const result = await exportHar.handler({ tabId: 3 }, state);
    const har = JSON.parse((result as { har: string }).har) as {
      log: { entries: { request: { bodySize: number }; response: { content: { size: number }; bodySize: number } }[] };
    };

    const entry = har.log.entries[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.request.bodySize).toBe(0);
    expect(entry.response.content.size).toBe(0);
    expect(entry.response.bodySize).toBe(-1);
  });
});
