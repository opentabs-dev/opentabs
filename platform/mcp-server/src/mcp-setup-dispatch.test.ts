/**
 * Unit tests for the tools/call handler dispatch pipeline in registerMcpHandlers.
 *
 * Tests the tools/call handler using real extension-protocol imports (no module
 * mocking). Dispatch calls are settled by self-completing mock WS objects that
 * schedule a handleExtensionMessage response via setTimeout(fn, 0). This avoids
 * module mock leakage across test workers.
 *
 * Key insight: request IDs are UUID strings (from getNextRequestId/crypto.randomUUID),
 * not numbers. The mock WS checks `parsed['id'] !== undefined` to detect requests.
 */

import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { WsHandle } from '@opentabs-dev/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { handleExtensionMessage } from './extension-protocol.js';
import type { McpServerInstance, RequestHandlerExtra } from './mcp-setup.js';
import { rebuildCachedBrowserTools, registerMcpHandlers } from './mcp-setup.js';
import { buildRegistry } from './registry.js';
import type { RegisteredPlugin } from './state.js';
import { createState } from './state.js';

/** No-op callbacks for handleExtensionMessage */
const noopCallbacks = {
  onToolConfigChanged: () => {},
  onPluginPermissionsPersist: () => {},
  onPluginLog: () => {},
  onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
  queryExtension: () => Promise.resolve(undefined),
};

/**
 * Create a mock WsHandle that automatically resolves any JSON-RPC request
 * with the given result. Responses are scheduled via setTimeout(fn, 0) so the
 * dispatch promise has a chance to return before being settled (matching real
 * WebSocket round-trip semantics).
 */
const createAutoResolveWs = (
  state: ReturnType<typeof createState>,
  result: unknown,
): WsHandle & { sent: string[] } => ({
  sent: [] as string[],
  send(msg: string) {
    this.sent.push(msg);
    const parsed = JSON.parse(msg) as Record<string, unknown>;
    // Requests have an `id` field; notifications do not
    if (parsed.id !== undefined) {
      const id = parsed.id;
      setTimeout(() => {
        handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', id, result }), noopCallbacks);
      }, 0);
    }
  },
  close() {},
});

/**
 * Create a mock WsHandle that automatically rejects any JSON-RPC request
 * with the given error payload. Used to simulate DispatchError cases.
 */
const createAutoRejectWs = (
  state: ReturnType<typeof createState>,
  error: { code: number; message: string; data?: Record<string, unknown> },
): WsHandle & { sent: string[] } => ({
  sent: [] as string[],
  send(msg: string) {
    this.sent.push(msg);
    const parsed = JSON.parse(msg) as Record<string, unknown>;
    if (parsed.id !== undefined) {
      const id = parsed.id;
      setTimeout(() => {
        handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', id, error }), noopCallbacks);
      }, 0);
    }
  },
  close() {},
});

/** Create a minimal RegisteredPlugin for testing */
const createPlugin = (name: string, toolNames: string[]): RegisteredPlugin => ({
  name,
  version: '1.0.0',
  displayName: name,
  urlPatterns: [`https://${name}.example.com/*`],
  excludePatterns: [],
  source: 'local' as const,
  iife: `(function(){/* ${name} */})()`,
  tools: toolNames.map(t => ({
    name: t,
    displayName: t,
    description: `${t} description`,
    icon: 'wrench',
    input_schema: { type: 'object' as const },
    output_schema: { type: 'object' as const },
  })),
});

/** Mock RequestHandlerExtra for testing */
const mockExtra: RequestHandlerExtra = {
  signal: new AbortController().signal,
  sendNotification: () => Promise.resolve(),
};

/** Handler type matching the McpServerInstance.setRequestHandler callback */
type RequestHandler = (
  request: { params: { name: string; arguments?: Record<string, unknown> } },
  extra: RequestHandlerExtra,
) => unknown;

/** Create a mock MCP server that captures the tools/call handler */
const createMockServer = () => {
  let callHandler: RequestHandler | null = null;
  const server: McpServerInstance = {
    setRequestHandler: (schema: unknown, handler) => {
      if (schema === CallToolRequestSchema) {
        callHandler = handler;
      }
    },
    connect: () => Promise.resolve(),
    sendToolListChanged: () => Promise.resolve(),
    sendResourceListChanged: () => Promise.resolve(),
    sendLoggingMessage: () => Promise.resolve(),
  };
  return {
    server,
    getCallHandler: () => {
      if (!callHandler) throw new Error('tools/call handler not registered');
      return callHandler;
    },
  };
};

describe('tools/call handler — browser tool path', () => {
  test('Zod validation failure returns isError with formatted message', async () => {
    const state = createState();
    state.browserTools = [
      {
        name: 'browser_test',
        description: 'Test tool',
        input: z.object({ url: z.string() }),
        handler: () => Promise.resolve({}),
      },
    ];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { tools: { browser_test: 'auto' } } };

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'browser_test', arguments: { url: 123 } } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
  });

  test('browser tool handler success returns sanitized output', async () => {
    const state = createState();
    state.pluginPermissions = { browser: { permission: 'auto' } };
    state.browserTools = [
      {
        name: 'browser_test',
        description: 'Test tool',
        input: z.object({}),
        handler: () => Promise.resolve({ tab: 'result', safe: true }),
      },
    ];
    rebuildCachedBrowserTools(state);

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'browser_test', arguments: {} } }, mockExtra)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('"tab"');
    expect(result.content[0]?.text).toContain('"result"');
  });

  test('browser tool handler throws returns "Browser tool error: ..." message', async () => {
    const state = createState();
    state.pluginPermissions = { browser: { permission: 'auto' } };
    state.browserTools = [
      {
        name: 'browser_test',
        description: 'Test tool',
        input: z.object({}),
        handler: () => Promise.reject(new Error('tab not found')),
      },
    ];
    rebuildCachedBrowserTools(state);

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'browser_test', arguments: {} } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Browser tool error: tab not found');
  });
});

describe('tools/call handler — browser tool disabled via pluginPermissions', () => {
  test('disabled browser tool returns isError with "disabled via configuration" message', async () => {
    const state = createState();
    state.browserTools = [
      {
        name: 'browser_execute_script',
        description: 'Execute script',
        input: z.object({}),
        handler: () => Promise.resolve({}),
      },
    ];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { tools: { browser_execute_script: 'off' } } };

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'browser_execute_script', arguments: {} } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('currently disabled');
  });

  test('enabled browser tool dispatches normally', async () => {
    const state = createState();
    state.browserTools = [
      {
        name: 'browser_list_tabs',
        description: 'List tabs',
        input: z.object({}),
        handler: () => Promise.resolve([{ id: 1, title: 'Test' }]),
      },
    ];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { tools: { browser_list_tabs: 'auto' } } };

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'browser_list_tabs', arguments: {} } }, mockExtra)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Test');
  });
});

describe('tools/call handler — plugin tool not found / disabled', () => {
  test('plugin tool not found returns isError', async () => {
    const state = createState();
    state.registry = buildRegistry([], []);

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'nonexistent_tool' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
  });

  test('plugin tool disabled returns isError', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'off' } } };

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('has not been reviewed yet');
    expect(result.content[0]?.text).toContain('plugin_inspect');
  });
});

describe('tools/call handler — schema validation path', () => {
  test('schema compilation failure (validate is null) returns descriptive error', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'auto' } } };
    const entry = state.registry.toolLookup.get('slack_send_message');
    if (!entry) throw new Error('Expected entry');
    entry.validate = null;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('schema compilation failed');
  });

  test('validator throws returns "validation failed unexpectedly" message', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'auto' } } };
    const entry = state.registry.toolLookup.get('slack_send_message');
    if (!entry) throw new Error('Expected entry');
    entry.validate = () => {
      throw new Error('catastrophic backtracking');
    };

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('validation failed unexpectedly');
  });

  test('validation failure returns "Invalid arguments" with error details', async () => {
    const state = createState();
    const plugin = createPlugin('slack', ['send_message']);
    plugin.tools = [
      {
        name: 'send_message',
        displayName: 'Send Message',
        description: 'Send a message',
        icon: 'wrench',
        input_schema: {
          type: 'object',
          properties: { channel: { type: 'string' } },
          required: ['channel'],
          additionalProperties: false,
        },
        output_schema: { type: 'object' },
      },
    ];
    state.registry = buildRegistry([plugin], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'auto' } } };

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message', arguments: {} } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
  });
});

describe('tools/call handler — concurrency and extension connection', () => {
  test('concurrency limit exceeded returns "Too many concurrent dispatches"', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'auto' } } };
    state.activeDispatches.set('slack', 5);

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Too many concurrent dispatches');
  });

  test('extension not connected returns "Extension not connected"', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'auto' } } };
    // extensionWs is null by default in createState()

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Extension not connected');
  });

  test('activeDispatches counter decrements in finally block even on error', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'auto' } } };
    state.extensionWs = createAutoRejectWs(state, {
      code: -32603,
      message: 'internal error',
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    expect(state.activeDispatches.get('slack')).toBeUndefined();
    await handler({ params: { name: 'slack_send_message' } }, mockExtra);
    expect(state.activeDispatches.get('slack')).toBeUndefined();
  });

  test('activeDispatches counter reaches 0 and entry is deleted from map', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'auto' } } };
    state.extensionWs = createAutoResolveWs(state, {
      output: { ok: true },
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    await handler({ params: { name: 'slack_send_message' } }, mockExtra);
    expect(state.activeDispatches.has('slack')).toBe(false);
  });
});

describe('tools/call handler — dispatch success and error codes', () => {
  let state: ReturnType<typeof createState>;

  beforeEach(() => {
    state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { tools: { send_message: 'auto' } } };
  });

  test('dispatch success returns sanitized output', async () => {
    state.extensionWs = createAutoResolveWs(state, {
      output: { messageId: 'msg123', text: 'hello' },
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('"messageId"');
    expect(result.content[0]?.text).toContain('"msg123"');
  });

  test('DispatchError with code -32001 prefixes "Tab closed:"', async () => {
    state.extensionWs = createAutoRejectWs(state, {
      code: -32001,
      message: 'the tab was closed',
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Tab closed: the tab was closed');
  });

  test('DispatchError with code -32002 prefixes "Tab unavailable:"', async () => {
    state.extensionWs = createAutoRejectWs(state, {
      code: -32002,
      message: 'slack not loaded',
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Tab unavailable: slack not loaded');
  });

  test('DispatchError with data.code (ToolError) prefixes "[CODE]"', async () => {
    state.extensionWs = createAutoRejectWs(state, {
      code: -32000,
      message: 'rate limited',
      data: { code: 'RATE_LIMITED' },
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('[RATE_LIMITED] rate limited');
  });

  test('DispatchError with structured fields produces human-readable prefix and JSON block', async () => {
    state.extensionWs = createAutoRejectWs(state, {
      code: -32603,
      message: 'Too many requests',
      data: { code: 'RATE_LIMITED', retryable: true, retryAfterMs: 5000, category: 'rate_limit' },
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';

    // Verify human-readable prefix
    expect(text).toContain('[ERROR code=RATE_LIMITED category=rate_limit retryable=true retryAfterMs=5000]');
    expect(text).toContain('Too many requests');

    // Verify machine-readable JSON block is present and parseable
    const jsonMatch = text.match(/```json\n(.+?)\n```/s);
    expect(jsonMatch).toBeTruthy();
    const jsonStr = (jsonMatch as RegExpMatchArray)[1] as string;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(parsed).toEqual({
      code: 'RATE_LIMITED',
      category: 'rate_limit',
      retryable: true,
      retryAfterMs: 5000,
    });
  });

  test('DispatchError with partial structured fields omits undefined fields from output', async () => {
    state.extensionWs = createAutoRejectWs(state, {
      code: -32603,
      message: 'Not authenticated',
      data: { code: 'AUTH_ERROR', category: 'auth' },
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';

    // Verify prefix contains only present fields
    expect(text).toContain('[ERROR code=AUTH_ERROR category=auth]');
    expect(text).not.toContain('retryable');
    expect(text).not.toContain('retryAfterMs');

    // Verify JSON block contains only present fields
    const jsonMatch = text.match(/```json\n(.+?)\n```/s);
    expect(jsonMatch).toBeTruthy();
    const jsonStr = (jsonMatch as RegExpMatchArray)[1] as string;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(parsed).toEqual({ code: 'AUTH_ERROR', category: 'auth' });
  });

  test('DispatchError with retryable only (no category) produces structured output', async () => {
    state.extensionWs = createAutoRejectWs(state, {
      code: -32603,
      message: 'Service overloaded',
      data: { code: 'OVERLOADED', retryable: true },
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('[ERROR code=OVERLOADED retryable=true]');
    expect(text).not.toContain('category');

    const jsonMatch = text.match(/```json\n(.+?)\n```/s);
    expect(jsonMatch).toBeTruthy();
    const jsonStr = (jsonMatch as RegExpMatchArray)[1] as string;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(parsed).toEqual({ code: 'OVERLOADED', retryable: true });
  });

  test('DispatchError with only code (no structured fields) uses legacy [CODE] format', async () => {
    state.extensionWs = createAutoRejectWs(state, {
      code: -32603,
      message: 'Something went wrong',
      data: { code: 'SOME_ERROR' },
    }) as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';

    // Legacy format: [CODE] message (no JSON block)
    expect(text).toBe('[SOME_ERROR] Something went wrong');
    expect(text).not.toContain('```json');
  });

  test('generic dispatch error returns "Tool dispatch error:" with message', async () => {
    // Use a WS whose send() throws — dispatchToExtension wraps this as a generic Error
    state.extensionWs = {
      sent: [] as string[],
      send() {
        throw new Error('unexpected network error');
      },
      close() {},
    } as unknown as typeof state.extensionWs;

    const { server, getCallHandler } = createMockServer();
    registerMcpHandlers(server, state);
    const handler = getCallHandler();

    const result = (await handler({ params: { name: 'slack_send_message' } }, mockExtra)) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    // dispatchToExtension wraps send() throws as "WebSocket send failed: <message>"
    expect(result.content[0]?.text).toContain('Tool dispatch error:');
    expect(result.content[0]?.text).toContain('unexpected network error');
  });
});
