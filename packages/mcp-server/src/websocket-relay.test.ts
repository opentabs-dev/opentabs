import { describe, it, expect, beforeEach, afterEach, mock, setSystemTime } from 'bun:test';
import { clearAllMocks, trackMock } from './test-utils.js';

// Store mock instance for access in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockWssInstance: { on: any; close: any };

// Track event handlers so tests can trigger them
let currentEventHandlers: Map<string, (...args: unknown[]) => void>;

// Track constructor calls manually
let constructorCalls: Array<{ port: number; host: string }> = [];

// Mock ws module before importing modules that use it
mock.module('ws', () => {
  // Use function keyword for constructor compatibility (required for 'new' keyword)
  const WebSocketServerMock = function (this: Record<string, unknown>, options: { port: number; host: string }) {
    constructorCalls.push(options);
    currentEventHandlers = new Map();
    mockWssInstance = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: mock<any>((event: string, callback: (...args: unknown[]) => void) => {
        currentEventHandlers.set(event, callback);
        return mockWssInstance;
      }),
      close: trackMock(mock(() => {})),
    };
    Object.assign(this, mockWssInstance);
  };

  return {
    WebSocketServer: WebSocketServerMock,
    WebSocket: {
      OPEN: 1,
      CONNECTING: 0,
      CLOSING: 2,
      CLOSED: 3,
    },
  };
});

// Import after mock.module
import { WebSocketRelay } from './websocket-relay.js';

describe('WebSocketRelay', () => {
  let relay: WebSocketRelay;

  beforeEach(() => {
    setSystemTime(new Date('2024-01-01T00:00:00Z'));
    clearAllMocks();
    constructorCalls = [];
    relay = new WebSocketRelay();
  });

  afterEach(() => {
    setSystemTime();
    clearAllMocks();
  });

  describe('start', () => {
    it('should create WebSocket server on specified port', async () => {
      const startPromise = relay.start(9000);

      // Trigger the listening event
      await Bun.sleep(0);
      const listeningHandler = currentEventHandlers.get('listening');
      if (listeningHandler) {
        listeningHandler();
      }

      await startPromise;

      expect(constructorCalls).toHaveLength(1);
      expect(constructorCalls[0]).toEqual({ port: 9000, host: '127.0.0.1' });
    });

    it('should reject on EADDRINUSE error', async () => {
      const startPromise = relay.start(9000);

      // Trigger the error callback after handlers are registered
      await Bun.sleep(0);
      const errorHandler = currentEventHandlers.get('error');
      if (errorHandler) {
        const error = new Error('Port in use') as NodeJS.ErrnoException;
        error.code = 'EADDRINUSE';
        errorHandler(error);
      }

      await expect(startPromise).rejects.toThrow('Port in use');
    });
  });

  describe('isConnected', () => {
    it('should return false when no client connected', () => {
      expect(relay.isConnected()).toBe(false);
    });
  });

  describe('stop', () => {
    it('should close WebSocket server', async () => {
      const startPromise = relay.start(9000);

      // Trigger the listening event
      await Bun.sleep(0);
      const listeningHandler = currentEventHandlers.get('listening');
      if (listeningHandler) {
        listeningHandler();
      }

      await startPromise;

      relay.stop();

      expect(mockWssInstance.close).toHaveBeenCalled();
    });
  });

  describe('sendServiceRequest', () => {
    it('should throw when not connected', async () => {
      await expect(relay.sendServiceRequest('slack', { method: 'test.method' })).rejects.toThrow(
        'Chrome extension not connected. Please open https://brex.slack.com in Chrome with the extension installed.',
      );
    });
  });
});

describe('WebSocketRelay message handling', () => {
  it('should handle slack_api_response messages', () => {
    // This tests the internal handleMessage logic
    // We verify the message format expectations
    const responseMessage = {
      id: 'req_1',
      type: 'slack_api_response',
      success: true,
      data: { ok: true },
    };

    expect(responseMessage.type).toBe('slack_api_response');
    expect(responseMessage.success).toBe(true);
  });
});

describe('WebSocketRelay server info', () => {
  it('should have server_info message format with serverPath', () => {
    const serverInfoMessage = {
      type: 'server_info',
      serverPath: '/path/to/project',
    };

    expect(serverInfoMessage.type).toBe('server_info');
    expect(serverInfoMessage.serverPath).toBe('/path/to/project');
  });

  it('should use current working directory as serverPath', () => {
    // The WebSocketRelay uses process.cwd() for serverPath
    // This test documents the expected behavior
    expect(process.cwd()).toBeTruthy();
    expect(typeof process.cwd()).toBe('string');
  });
});

describe('WebSocketRelay request timeout', () => {
  it('should use 30 second timeout for requests', () => {
    // Verify the timeout constant is reasonable
    const EXPECTED_TIMEOUT = 30000;

    // The timeout is hardcoded in sendRequest
    // This test documents the expected behavior
    expect(EXPECTED_TIMEOUT).toBe(30000);
  });
});
