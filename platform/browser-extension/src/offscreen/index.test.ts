import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { InternalMessage } from '../extension-messages.js';
import { isValidWsOrigin, wsToHttpBase } from './ws-utils.js';

describe('isValidWsOrigin', () => {
  test('valid ws:// URL with matching host passes', () => {
    expect(isValidWsOrigin('ws://localhost:9515/ws', 'http://localhost:9515')).toBe(true);
  });

  test('valid wss:// URL with matching host passes', () => {
    expect(isValidWsOrigin('wss://example.com/ws', 'https://example.com')).toBe(true);
  });

  test('mismatched host rejects', () => {
    expect(isValidWsOrigin('ws://evil.com/ws', 'http://localhost:9515')).toBe(false);
  });

  test('mismatched port rejects', () => {
    expect(isValidWsOrigin('ws://localhost:1234/ws', 'http://localhost:9515')).toBe(false);
  });

  test('non-ws protocol rejects', () => {
    expect(isValidWsOrigin('http://localhost:9515/ws', 'http://localhost:9515')).toBe(false);
  });

  test('ftp protocol rejects', () => {
    expect(isValidWsOrigin('ftp://localhost:9515/ws', 'http://localhost:9515')).toBe(false);
  });

  test('wrong path rejects', () => {
    expect(isValidWsOrigin('ws://localhost:9515/other', 'http://localhost:9515')).toBe(false);
  });

  test('path with trailing suffix rejects', () => {
    expect(isValidWsOrigin('ws://localhost:9515/ws/extra', 'http://localhost:9515')).toBe(false);
  });

  test('malformed URL rejects', () => {
    expect(isValidWsOrigin('not-a-url', 'http://localhost:9515')).toBe(false);
  });
});

describe('wsToHttpBase', () => {
  test('converts ws:// to http://', () => {
    expect(wsToHttpBase('ws://localhost:9515/ws')).toBe('http://localhost:9515');
  });

  test('converts wss:// to https://', () => {
    expect(wsToHttpBase('wss://example.com/ws')).toBe('https://example.com');
  });
});

// ---------------------------------------------------------------------------
// ws:send handler — try-catch around JSON.stringify
// ---------------------------------------------------------------------------

describe('ws:send handler', () => {
  type MessageListener = (
    message: InternalMessage,
    sender: { id: string },
    sendResponse: (response: unknown) => void,
  ) => boolean | undefined;

  let capturedListener: MessageListener | null = null;
  const mockSendFn = vi.fn();

  beforeAll(async () => {
    // Set up Chrome API mock before importing index.ts, which registers
    // chrome.runtime.onMessage.addListener synchronously at module load time.
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: vi.fn((_msg: unknown, callback?: (resp: unknown) => void) => {
          // IIFE calls sendMessage with a callback to get the server URL.
          // Call the callback synchronously with undefined (no custom URL).
          if (typeof callback === 'function') callback(undefined);
          return Promise.resolve();
        }),
        onMessage: {
          addListener: (listener: MessageListener) => {
            capturedListener = listener;
          },
        },
        lastError: undefined as unknown,
      },
    };

    // Mock WebSocket using a class so it works correctly as a constructor.
    // readyState is immediately OPEN (1) so the ws:send handler takes the
    // connected branch when the test triggers it.
    const capturedSendFn = mockSendFn;
    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 1;
      send = capturedSendFn;
      close = vi.fn();
      onopen: (() => void) | null = null;
      onmessage: unknown = null;
      onclose: unknown = null;
      onerror: unknown = null;
    }
    // Direct assignment works because Node.js 22's WebSocket global is
    // writable and configurable.
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;

    // Mock fetch: return a valid ws-info response so refreshWsUrl succeeds
    // and connect() creates the MockWebSocket. Return 404 for auth.json
    // (bootstrapFromAuthFile handles 404 gracefully — wsSecret stays null).
    (globalThis as Record<string, unknown>).fetch = (url: unknown) => {
      if (typeof url === 'string' && url.includes('/ws-info')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ wsUrl: 'ws://127.0.0.1:9515/ws' }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };

    // Import the offscreen module — this registers the chrome message listener
    // synchronously and starts the async IIFE that calls connect().
    await import('./index.js');

    // Wait for the async IIFE (bootstrapFromAuthFile + connect) to settle.
    // All mocked fetch calls return resolved Promises, so all microtasks
    // complete before setTimeout fires.
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  test('logs console.error for unserializable data instead of crashing', () => {
    const listener = capturedListener;
    if (!listener) throw new Error('capturedListener was not registered');

    // Build a circular reference — JSON.stringify throws on circular structures
    const circularData: Record<string, unknown> = { method: 'test.invoke' };
    circularData.self = circularData;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendResponse = vi.fn();

    listener({ type: 'ws:send', data: circularData }, { id: 'test-extension-id' }, sendResponse);

    // console.error should have been called with the offscreen prefix and method name
    expect(errorSpy).toHaveBeenCalledOnce();
    const firstCall = errorSpy.mock.calls[0] as [string, string | undefined, unknown] | undefined;
    expect(firstCall?.[0]).toContain('[opentabs:offscreen]');
    expect(firstCall?.[1]).toBe('test.invoke');

    // sendResponse is still called — the WebSocket connection is not disrupted
    expect(sendResponse).toHaveBeenCalledWith({ sent: true });

    // ws.send is never called because JSON.stringify throws before it is reached
    expect(mockSendFn).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
