import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { clearAllMocks, trackMock } from './test-utils.js';

// Create mock functions before module mocks
const mockRelayStart = trackMock(mock(() => Promise.resolve(undefined)));

const mockStartHttpServer = trackMock(
  mock(() =>
    Promise.resolve({
      close: mock(() => Promise.resolve(undefined)),
    }),
  ),
);

// registerTool must return a RegisteredTool-like object since tool registration
// functions store the return value in a Map<string, RegisteredTool>.
const mockRegisterTool = trackMock(
  mock((name: string) => ({
    name,
    description: `mock-${name}`,
    inputSchema: undefined,
    handler: () => {},
    enabled: true,
    update: () => {},
    remove: () => {},
    enable: () => {},
    disable: () => {},
  })),
);
const mockConnect = trackMock(mock(() => Promise.resolve(undefined)));

// Track McpServer calls manually since bun:test mock() doesn't work as constructor
const mcpServerCalls: Array<{ info: Record<string, unknown>; options: Record<string, unknown> | undefined }> = [];

// Mock the websocket relay (used by all tool modules via utils.ts)
mock.module('./websocket-relay', () => ({
  relay: {
    start: mockRelayStart,
    sendServiceRequest: mock(() => {}),
    sendSlackEdgeRequest: mock(() => {}),

    sendBrowserRequest: mock(() => {}),
    reloadExtension: mock(() => {}),
    isConnected: mock(() => false),
    isStarted: mock(() => false),
    stop: mock(() => {}),
  },
  DEFAULT_PORT: 8765,
}));

// Mock the http-server module
mock.module('./http-server', () => ({
  startHttpServer: mockStartHttpServer,
}));

// Mock the MCP SDK - use class pattern for proper constructor behavior
mock.module('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class MockMcpServer {
    registerTool = mockRegisterTool;
    connect = mockConnect;

    constructor(info: Record<string, unknown>, options?: Record<string, unknown>) {
      mcpServerCalls.push({ info, options });
    }

    isConnected() {
      return false;
    }
  },
}));

mock.module('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class MockStdioServerTransport {},
}));

// Import after mock.module
import { createServer } from './server.js';

describe('Server', () => {
  beforeEach(() => {
    clearAllMocks();
    mcpServerCalls.length = 0;
  });

  describe('createServer', () => {
    it('should create MCP server with correct name and version', async () => {
      // Import version from package.json to avoid hardcoding
      const pkg = await import('../package.json');

      createServer();

      expect(mcpServerCalls).toHaveLength(1);
      expect(mcpServerCalls[0].info).toEqual({
        name: 'OpenTabs',
        version: pkg.default.version,
      });
    });

    it('should enable debounced tool change notifications', () => {
      createServer();

      expect(mcpServerCalls).toHaveLength(1);
      expect(mcpServerCalls[0].options).toEqual({
        debouncedNotificationMethods: ['notifications/tools/list_changed'],
      });
    });

    it('should register all tools on the server', () => {
      const server = createServer();

      // The registerTool method should have been called multiple times
      expect(server.registerTool).toHaveBeenCalled();
    });

    it('should return the server instance', () => {
      const server = createServer();

      expect(server).toBeDefined();
      expect(typeof server.registerTool).toBe('function');
    });
  });
});
