import { beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { savePluginPermissions } from './config.js';
import { buildConfigStatePayload, sendToExtension } from './extension-handlers.js';
import {
  dispatchToExtension,
  isDispatchError,
  sendConfirmationRequest,
  sendInvocationEnd,
  sendInvocationStart,
} from './extension-protocol.js';
import { log } from './logger.js';
import type { DispatchCallbacks, RequestHandlerExtra } from './mcp-tool-dispatch.js';
import {
  formatStructuredError,
  formatZodError,
  handleBrowserToolCall,
  handlePluginInspect,
  handlePluginMarkReviewed,
  handlePluginToolCall,
  REVIEW_GUIDANCE,
  sanitizeOutput,
} from './mcp-tool-dispatch.js';
import type { CachedBrowserTool, RegisteredPlugin, ServerState, ToolLookupEntry } from './state.js';
import {
  appendAuditEntry,
  consumeReviewToken,
  generateReviewToken,
  getMergedTabMapping,
  getToolPermission,
  validateReviewToken,
} from './state.js';

describe('sanitizeOutput', () => {
  describe('primitives passthrough', () => {
    test('returns string unchanged', () => {
      expect(sanitizeOutput('hello')).toBe('hello');
    });

    test('returns number unchanged', () => {
      expect(sanitizeOutput(42)).toBe(42);
    });

    test('returns boolean unchanged', () => {
      expect(sanitizeOutput(false)).toBe(false);
    });

    test('returns null unchanged', () => {
      expect(sanitizeOutput(null)).toBeNull();
    });

    test('returns undefined unchanged', () => {
      expect(sanitizeOutput(undefined)).toBeUndefined();
    });
  });

  describe('nested objects', () => {
    test('returns plain object unchanged when no dangerous keys', () => {
      expect(sanitizeOutput({ a: 1, b: 'two' })).toEqual({ a: 1, b: 'two' });
    });

    test('returns deeply nested objects recursively sanitized', () => {
      expect(sanitizeOutput({ outer: { inner: { value: 42 } } })).toEqual({
        outer: { inner: { value: 42 } },
      });
    });
  });

  describe('arrays', () => {
    test('returns array with items recursively sanitized', () => {
      expect(sanitizeOutput([1, 'two', { a: 3 }])).toEqual([1, 'two', { a: 3 }]);
    });

    test('sanitizes dangerous keys inside array items', () => {
      expect(sanitizeOutput([{ __proto__: 'x', safe: 1 }])).toEqual([{ safe: 1 }]);
    });
  });

  describe('dangerous key removal', () => {
    test('removes __proto__ key', () => {
      expect(sanitizeOutput({ __proto__: 'bad', safe: 1 })).toEqual({ safe: 1 });
    });

    test('removes constructor key', () => {
      expect(sanitizeOutput({ constructor: 'bad', safe: 1 })).toEqual({ safe: 1 });
    });

    test('removes prototype key', () => {
      expect(sanitizeOutput({ prototype: 'bad', safe: 1 })).toEqual({ safe: 1 });
    });

    test('removes all dangerous keys from the same object', () => {
      expect(sanitizeOutput({ __proto__: 'bad', constructor: 'bad', prototype: 'bad', ok: 1 })).toEqual({ ok: 1 });
    });

    test('removes dangerous keys recursively in nested objects', () => {
      expect(sanitizeOutput({ nested: { __proto__: 'bad', ok: 2 } })).toEqual({
        nested: { ok: 2 },
      });
    });
  });

  describe('depth limit', () => {
    test('returns [Object too deep] when depth exceeds 50', () => {
      expect(sanitizeOutput({ key: 'value' }, 51)).toBe('[Object too deep]');
    });

    test('does not truncate at depth exactly 50', () => {
      expect(sanitizeOutput({ key: 'value' }, 50)).toEqual({ key: 'value' });
    });
  });
});

describe('formatStructuredError', () => {
  test('code-only format (no data) produces [CODE] message', () => {
    expect(formatStructuredError('NOT_FOUND', 'Resource not found')).toBe('[NOT_FOUND] Resource not found');
  });

  test('data with no structured fields produces legacy [CODE] message', () => {
    expect(formatStructuredError('UNKNOWN', 'An error occurred', { otherField: 'value' })).toBe(
      '[UNKNOWN] An error occurred',
    );
  });

  test('with category produces structured format', () => {
    const result = formatStructuredError('RATE_LIMIT', 'Too many requests', { category: 'rate_limit' });
    expect(result).toContain('[ERROR code=RATE_LIMIT category=rate_limit]');
    expect(result).toContain('Too many requests');
    expect(result).toContain('```json');
    expect(result).toContain('"category":"rate_limit"');
  });

  test('with retryable=true produces structured format', () => {
    const result = formatStructuredError('TRANSIENT', 'Try again', { retryable: true });
    expect(result).toContain('[ERROR code=TRANSIENT retryable=true]');
    expect(result).toContain('Try again');
    expect(result).toContain('"retryable":true');
  });

  test('with retryable=false produces structured format', () => {
    const result = formatStructuredError('PERMANENT', 'Do not retry', { retryable: false });
    expect(result).toContain('[ERROR code=PERMANENT retryable=false]');
    expect(result).toContain('"retryable":false');
  });

  test('with retryAfterMs produces structured format', () => {
    const result = formatStructuredError('THROTTLED', 'Slow down', { retryAfterMs: 5000 });
    expect(result).toContain('[ERROR code=THROTTLED retryAfterMs=5000]');
    expect(result).toContain('"retryAfterMs":5000');
  });

  test('all fields present produces full structured format', () => {
    const result = formatStructuredError('RATE_LIMIT', 'Too many requests', {
      category: 'rate_limit',
      retryable: true,
      retryAfterMs: 60000,
    });
    expect(result).toContain('[ERROR code=RATE_LIMIT category=rate_limit retryable=true retryAfterMs=60000]');
    expect(result).toContain('Too many requests');
    expect(result).toContain('"code":"RATE_LIMIT"');
    expect(result).toContain('"category":"rate_limit"');
    expect(result).toContain('"retryable":true');
    expect(result).toContain('"retryAfterMs":60000');
  });
});

describe('formatZodError', () => {
  test('single issue with path', () => {
    const result = z.object({ name: z.string() }).safeParse({ name: 123 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toMatch(/^Invalid arguments:/);
      expect(formatted).toContain('  - name:');
    }
  });

  test('multiple issues list all failing fields', () => {
    const result = z.object({ a: z.string(), b: z.number() }).safeParse({ a: 1, b: 'two' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toMatch(/^Invalid arguments:/);
      expect(formatted).toContain('  - a:');
      expect(formatted).toContain('  - b:');
    }
  });

  test('root-level issue shows (root) as path', () => {
    const result = z.string().safeParse(42);
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('  - (root):');
    }
  });

  test('nested path joins segments with dot', () => {
    const result = z.object({ user: z.object({ age: z.number() }) }).safeParse({ user: { age: 'old' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('  - user.age:');
    }
  });
});

// ---------------------------------------------------------------------------
// Mocks for handler tests (handleBrowserToolCall, handlePluginToolCall)
// ---------------------------------------------------------------------------

vi.mock('./extension-handlers.js', () => ({
  sendToExtension: vi.fn(),
  buildConfigStatePayload: vi
    .fn()
    .mockReturnValue({ plugins: [], failedPlugins: [], browserTools: [], serverVersion: '0.0.0' }),
}));

vi.mock('./extension-protocol.js', () => ({
  dispatchToExtension: vi.fn(),
  isDispatchError: vi.fn(),
  sendInvocationStart: vi.fn(),
  sendInvocationEnd: vi.fn(),
  sendConfirmationRequest: vi.fn(),
}));

vi.mock('./state.js', () => ({
  getToolPermission: vi.fn(),
  appendAuditEntry: vi.fn(),
  generateReviewToken: vi.fn().mockReturnValue('mock-review-token-uuid'),
  validateReviewToken: vi.fn().mockReturnValue(true),
  consumeReviewToken: vi.fn(),
  getMergedTabMapping: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('./config.js', () => ({
  savePluginPermissions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./sanitize-error.js', () => ({
  sanitizeErrorMessage: vi.fn((msg: string) => msg),
}));

vi.mock('./logger.js', () => ({
  log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }));
vi.mock('./telemetry.js', () => ({
  trackEvent: mockTrackEvent,
  getSessionId: vi.fn().mockReturnValue('test-session-id'),
}));

/** Create a minimal mock ServerState for handler tests */
const createMockState = (overrides: Partial<ServerState> = {}): ServerState =>
  ({
    extensionConnections: new Map([
      [
        'test-conn',
        {
          ws: { send: vi.fn(), close: vi.fn() },
          connectionId: 'test-conn',
          profileLabel: 'test-conn',
          tabMapping: new Map(),
          activeNetworkCaptures: new Set(),
        },
      ],
    ]),
    activeDispatches: new Map<string, number>(),
    auditLog: [],
    skipPermissions: false,
    pluginPermissions: {},
    pendingConfirmations: new Map(),
    ...overrides,
  }) as unknown as ServerState;

/** Create a mock CachedBrowserTool */
const createMockBrowserTool = (
  overrides: Partial<{ name: string; handler: CachedBrowserTool['tool']['handler']; schema: z.ZodObject }> = {},
): CachedBrowserTool => {
  const schema = overrides.schema ?? z.object({ url: z.string().optional() });
  return {
    name: overrides.name ?? 'browser_test_tool',
    description: 'A test browser tool',
    inputSchema: {},
    tool: {
      name: overrides.name ?? 'browser_test_tool',
      description: 'A test browser tool',
      input: schema,
      handler: overrides.handler ?? vi.fn().mockResolvedValue({ result: 'ok' }),
    },
  };
};

/** Create a mock RequestHandlerExtra */
const createMockExtra = (overrides: Partial<RequestHandlerExtra> = {}): RequestHandlerExtra => ({
  signal: new AbortController().signal,
  sendNotification: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

/** Create mock DispatchCallbacks */
const createMockCallbacks = (): DispatchCallbacks => ({
  onToolConfigChanged: vi.fn(),
});

/** Create a mock ToolLookupEntry */
const createMockLookup = (overrides: Partial<ToolLookupEntry> = {}): ToolLookupEntry => ({
  pluginName: 'testplugin',
  toolName: 'test_action',
  validate: vi.fn().mockReturnValue(true),
  validationErrors: vi.fn().mockReturnValue(''),
  ...overrides,
});

// ---------------------------------------------------------------------------
// handleBrowserToolCall tests
// ---------------------------------------------------------------------------

describe('handleBrowserToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('permission off returns disabled error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('off');
    const state = createMockState();
    const bt = createMockBrowserTool();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('currently disabled');
    expect(result.content[0]?.text).toContain('In the OpenTabs side panel: toggle the tool on');
    expect(result.content[0]?.text).toContain('opentabs config set plugin-permission.browser-tool auto');
    expect(result.content[0]?.text).toContain(
      'opentabs config set tool-permission.browser-tool.browser_test_tool auto',
    );
  });

  test('permission auto executes immediately', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
    expect(sendConfirmationRequest).not.toHaveBeenCalled();
  });

  test('permission ask with deny returns error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue({ action: 'deny', alwaysAllow: false });
    const state = createMockState();
    const bt = createMockBrowserTool();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('denied by the user');
    expect(sendConfirmationRequest).toHaveBeenCalledWith(state, 'browser_test_tool', 'browser', {});
  });

  test('permission ask with allow executes tool', async () => {
    vi.mocked(getToolPermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue({ action: 'allow', alwaysAllow: false });
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
    expect(savePluginPermissions).not.toHaveBeenCalled();
    expect(callbacks.onToolConfigChanged).not.toHaveBeenCalled();
  });

  test('permission ask with alwaysAllow persists to auto', async () => {
    vi.mocked(getToolPermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue({ action: 'allow', alwaysAllow: true });
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
    expect(state.pluginPermissions.browser?.tools?.browser_test_tool).toBe('auto');
    expect(savePluginPermissions).toHaveBeenCalledWith(state, state.pluginPermissions);
    expect(callbacks.onToolConfigChanged).toHaveBeenCalled();
    expect(sendToExtension).toHaveBeenCalledWith(state, {
      jsonrpc: '2.0',
      method: 'plugins.changed',
      params: expect.objectContaining({ plugins: expect.any(Array) }),
    });
  });

  test('permission ask sends progress notification when progressToken available', async () => {
    vi.mocked(getToolPermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue({ action: 'allow', alwaysAllow: false });
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra = createMockExtra({ _meta: { progressToken: 'tok-1' }, sendNotification });
    const callbacks = createMockCallbacks();

    await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progressToken: 'tok-1',
          message: expect.stringContaining('approval') as string,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  test('permission ask with extension disconnect returns error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockRejectedValue(new Error('disconnected'));
    const state = createMockState();
    const bt = createMockBrowserTool();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('extension is not connected');
  });

  test('Zod validation failure returns isError with formatted message', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({ url: z.string() }) });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', { url: 123 }, bt, extra, callbacks);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
  });

  test('successful execution returns sanitized output (dangerous keys stripped)', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const handler = vi.fn().mockResolvedValue({ safe: 'value', __proto__: 'bad' });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toHaveProperty('safe', 'value');
    expect(parsed).not.toHaveProperty('__proto__');
  });

  test('handler error returns "Browser tool error:" message', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');

    const handler = vi.fn().mockRejectedValue(new Error('tab crashed'));
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Browser tool error: tab crashed');
  });

  test('audit entry recorded on success', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(appendAuditEntry).toHaveBeenCalledTimes(1);
    const entry = (vi.mocked(appendAuditEntry).mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry).toMatchObject({
      tool: 'browser_test_tool',
      plugin: 'browser',
      success: true,
    });
    expect(entry.error).toBeUndefined();
  });

  test('audit entry recorded on failure with error info', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');

    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(appendAuditEntry).toHaveBeenCalledTimes(1);
    const entry = (vi.mocked(appendAuditEntry).mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry).toMatchObject({
      tool: 'browser_test_tool',
      plugin: 'browser',
      success: false,
      error: { code: 'UNKNOWN', message: 'boom' },
    });
  });

  test('sendInvocationStart and sendInvocationEnd are called', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(sendInvocationStart).toHaveBeenCalledWith(state, 'browser', 'browser_test_tool');
    expect(sendInvocationEnd).toHaveBeenCalledWith(
      state,
      'browser',
      'browser_test_tool',
      expect.any(Number) as number,
      true,
    );
  });

  test('sendInvocationEnd reports success=false on error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');

    const handler = vi.fn().mockRejectedValue(new Error('tool failed'));
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(sendInvocationEnd).toHaveBeenCalledWith(
      state,
      'browser',
      'browser_test_tool',
      expect.any(Number) as number,
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// handlePluginToolCall tests
// ---------------------------------------------------------------------------

describe('handlePluginToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('permission off for unreviewed plugin returns review flow instructions', async () => {
    vi.mocked(getToolPermission).mockReturnValue('off');
    const pluginMap = new Map([['testplugin', { name: 'testplugin', version: '2.0.0' }]]) as unknown as ReadonlyMap<
      string,
      RegisteredPlugin
    >;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
      pluginPermissions: {},
    });
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('"testplugin" (v2.0.0) has not been reviewed yet');
    expect(text).toContain('plugin_inspect');
    expect(text).toContain('plugin_mark_reviewed');
    expect(text).toContain('OpenTabs side panel');
  });

  test('permission off for version-updated plugin returns re-review instructions', async () => {
    vi.mocked(getToolPermission).mockReturnValue('off');
    const pluginMap = new Map([['testplugin', { name: 'testplugin', version: '3.0.0' }]]) as unknown as ReadonlyMap<
      string,
      RegisteredPlugin
    >;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
      pluginPermissions: { testplugin: { reviewedVersion: '2.0.0' } },
    });
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('"testplugin" has been updated from v2.0.0 to v3.0.0 and needs re-review');
    expect(text).toContain('plugin_inspect');
    expect(text).toContain('plugin_mark_reviewed');
    expect(text).toContain('OpenTabs side panel');
  });

  test('browser tool off error has no review flow', async () => {
    vi.mocked(getToolPermission).mockReturnValue('off');
    const state = createMockState();
    const bt = createMockBrowserTool();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra, callbacks);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('currently disabled');
    expect(text).not.toContain('plugin_inspect');
    expect(text).not.toContain('review');
  });

  test('permission ask with deny returns error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue({ action: 'deny', alwaysAllow: false });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('denied by the user');
    expect(sendConfirmationRequest).toHaveBeenCalledWith(state, 'test_action', 'testplugin', {});
  });

  test('permission ask with allow executes tool', async () => {
    vi.mocked(getToolPermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue({ action: 'allow', alwaysAllow: false });
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: { ok: true } });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    expect(dispatchToExtension).toHaveBeenCalled();
    expect(savePluginPermissions).not.toHaveBeenCalled();
  });

  test('permission ask with alwaysAllow persists to auto', async () => {
    vi.mocked(getToolPermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue({ action: 'allow', alwaysAllow: true });
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: { ok: true } });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    expect(state.pluginPermissions.testplugin?.tools?.test_action).toBe('auto');
    expect(savePluginPermissions).toHaveBeenCalledWith(state, state.pluginPermissions);
    expect(callbacks.onToolConfigChanged).toHaveBeenCalled();
    expect(sendToExtension).toHaveBeenCalledWith(state, {
      jsonrpc: '2.0',
      method: 'plugins.changed',
      params: expect.objectContaining({ plugins: expect.any(Array) }),
    });
  });

  test('permission auto proceeds to dispatch without confirmation', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: { id: '123' } });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    expect(sendConfirmationRequest).not.toHaveBeenCalled();
  });

  test('skipPermissions=true converts ask to auto (tool executes without prompt)', async () => {
    // getToolPermission converts 'ask' → 'auto' when skipPermissions is true
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState({ skipPermissions: true });
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    expect(sendConfirmationRequest).not.toHaveBeenCalled();
  });

  test('skipPermissions=true with tool permission off returns disabled error', async () => {
    // skipPermissions only converts 'ask' → 'auto'; 'off' stays 'off'
    vi.mocked(getToolPermission).mockReturnValue('off');
    const state = createMockState({
      skipPermissions: true,
      registry: { plugins: new Map([['testplugin', { version: '1.0.0' }]]) } as never,
    });
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('has not been reviewed yet');
    expect(result.content[0]?.text).toContain('plugin_inspect');
  });

  test('schema compilation failure (validate is null) returns error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const state = createMockState();
    const lookup = createMockLookup({
      validate: null,
      validationErrors: vi.fn().mockReturnValue('Schema compilation error'),
    });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('schema compilation failed');
  });

  test('validator throws returns "validation failed unexpectedly"', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const state = createMockState();
    const lookup = createMockLookup({
      validate: vi.fn().mockImplementation(() => {
        throw new Error('catastrophic backtracking');
      }),
    });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('validation failed unexpectedly');
  });

  test('validation failure returns "Invalid arguments" with errors', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const state = createMockState();
    const lookup = createMockLookup({
      validate: vi.fn().mockReturnValue(false),
      validationErrors: vi.fn().mockReturnValue('missing required field "channel"'),
    });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
    expect(result.content[0]?.text).toContain('missing required field "channel"');
  });

  test('concurrency limit exceeded returns error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const state = createMockState();
    state.activeDispatches.set('testplugin', 25);
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Too many concurrent dispatches');
    expect(result.content[0]?.text).toContain('testplugin');
  });

  test('extension not connected returns error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const state = createMockState({ extensionConnections: new Map() });
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Extension not connected');
  });

  test('successful dispatch returns sanitized output', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: { id: '123', name: 'test' } });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { key: 'val' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('"id"');
    expect(result.content[0]?.text).toContain('"123"');
  });

  test('successful dispatch sanitizes dangerous keys from output', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: { safe: 1, __proto__: 'bad', constructor: 'bad' } });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toHaveProperty('safe', 1);
    expect(parsed).not.toHaveProperty('__proto__');
    expect(parsed).not.toHaveProperty('constructor');
  });

  test('dispatch result without output field uses raw result', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ directResult: true });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toHaveProperty('directResult', true);
  });

  test('DispatchError with code -32001 prefixes "Tab closed:"', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const err = Object.assign(new Error('tab was closed'), { name: 'DispatchError', code: -32001, data: undefined });
    vi.mocked(dispatchToExtension).mockRejectedValue(err);
    vi.mocked(isDispatchError).mockReturnValue(true);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tab closed:');
  });

  test('DispatchError with code -32002 prefixes "Tab unavailable:"', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const err = Object.assign(new Error('plugin not loaded'), { name: 'DispatchError', code: -32002, data: undefined });
    vi.mocked(dispatchToExtension).mockRejectedValue(err);
    vi.mocked(isDispatchError).mockReturnValue(true);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tab unavailable:');
  });

  test('DispatchError with data.code (ToolError) formats structured error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const err = Object.assign(new Error('rate limited'), {
      name: 'DispatchError',
      code: -32000,
      data: { code: 'RATE_LIMITED', category: 'rate_limit', retryable: true, retryAfterMs: 5000 },
    });
    vi.mocked(dispatchToExtension).mockRejectedValue(err);
    vi.mocked(isDispatchError).mockReturnValue(true);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[ERROR code=RATE_LIMITED');
    expect(text).toContain('category=rate_limit');
    expect(text).toContain('retryable=true');
    expect(text).toContain('retryAfterMs=5000');
  });

  test('DispatchError with data.code only (no structured fields) uses legacy format', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const err = Object.assign(new Error('something wrong'), {
      name: 'DispatchError',
      code: -32000,
      data: { code: 'SOME_ERROR' },
    });
    vi.mocked(dispatchToExtension).mockRejectedValue(err);
    vi.mocked(isDispatchError).mockReturnValue(true);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('[SOME_ERROR] something wrong');
  });

  test('generic non-dispatch error returns "Tool dispatch error:" message', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockRejectedValue(new Error('network failure'));
    vi.mocked(isDispatchError).mockReturnValue(false);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tool dispatch error:');
    expect(result.content[0]?.text).toContain('network failure');
  });

  test('activeDispatches counter increments and decrements correctly', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    expect(state.activeDispatches.get('testplugin')).toBeUndefined();
    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );
    // After completion, counter should be cleaned up (deleted when reaches 0)
    expect(state.activeDispatches.has('testplugin')).toBe(false);
  });

  test('activeDispatches counter decrements on error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockRejectedValue(new Error('fail'));
    vi.mocked(isDispatchError).mockReturnValue(false);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );
    expect(state.activeDispatches.has('testplugin')).toBe(false);
  });

  test('sendInvocationStart and sendInvocationEnd are called', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(sendInvocationStart).toHaveBeenCalledWith(state, 'testplugin', 'test_action');
    expect(sendInvocationEnd).toHaveBeenCalledWith(
      state,
      'testplugin',
      'test_action',
      expect.any(Number) as number,
      true,
    );
  });

  test('sendInvocationEnd reports success=false on error', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockRejectedValue(new Error('fail'));
    vi.mocked(isDispatchError).mockReturnValue(false);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(sendInvocationEnd).toHaveBeenCalledWith(
      state,
      'testplugin',
      'test_action',
      expect.any(Number) as number,
      false,
    );
  });

  test('audit entry recorded on success', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(appendAuditEntry).toHaveBeenCalledTimes(1);
    const entry = (vi.mocked(appendAuditEntry).mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry).toMatchObject({
      tool: 'testplugin_test_action',
      plugin: 'testplugin',
      success: true,
    });
  });

  test('audit entry recorded on failure with error info', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const err = Object.assign(new Error('not found'), {
      name: 'DispatchError',
      code: -32000,
      data: { code: 'NOT_FOUND', category: 'client' },
    });
    vi.mocked(dispatchToExtension).mockRejectedValue(err);
    vi.mocked(isDispatchError).mockReturnValue(true);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(appendAuditEntry).toHaveBeenCalledTimes(1);
    const entry = (vi.mocked(appendAuditEntry).mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry).toMatchObject({
      tool: 'testplugin_test_action',
      plugin: 'testplugin',
      success: false,
      error: { code: 'NOT_FOUND', message: 'not found', category: 'client' },
    });
  });

  test('progress reporting with progressToken passes onProgress to dispatch', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra({ _meta: { progressToken: 'prog-1' } });
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(dispatchToExtension).toHaveBeenCalledWith(
      state,
      'tool.dispatch',
      { plugin: 'testplugin', tool: 'test_action', input: {} },
      expect.objectContaining({
        progressToken: 'prog-1',
        onProgress: expect.any(Function) as () => void,
      }) as Record<string, unknown>,
    );
  });

  test('dispatch without progressToken does not include onProgress', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra(); // no _meta
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(dispatchToExtension).toHaveBeenCalledWith(
      state,
      'tool.dispatch',
      { plugin: 'testplugin', tool: 'test_action', input: {} },
      expect.objectContaining({
        onProgress: undefined,
      }) as Record<string, unknown>,
    );
  });

  test('extension not connected sets success=false in audit and invocationEnd', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    const state = createMockState({ extensionConnections: new Map() });
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(sendInvocationEnd).toHaveBeenCalledWith(
      state,
      'testplugin',
      'test_action',
      expect.any(Number) as number,
      false,
    );
    const entry = (vi.mocked(appendAuditEntry).mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry.success).toBe(false);
  });

  test('tabId is stripped from args before Ajv validation', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const validate = vi.fn().mockReturnValue(true);
    const lookup = createMockLookup({ validate });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { channel: '#general', tabId: 42 },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    // Ajv validate should have been called with args that do NOT contain tabId
    expect(validate).toHaveBeenCalledTimes(1);
    const validatedArgs = validate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(validatedArgs).toHaveProperty('channel', '#general');
    expect(validatedArgs).not.toHaveProperty('tabId');
  });

  test('tabId is threaded as top-level param to dispatchToExtension', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { key: 'val', tabId: 123 },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(dispatchToExtension).toHaveBeenCalledWith(
      state,
      'tool.dispatch',
      expect.objectContaining({
        plugin: 'testplugin',
        tool: 'test_action',
        input: { key: 'val' },
        tabId: 123,
      }) as Record<string, unknown>,
      expect.any(Object) as Record<string, unknown>,
    );
  });

  test('tabId is omitted from dispatch params when not present in args', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { key: 'val' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    const dispatchCall = vi.mocked(dispatchToExtension).mock.calls[0];
    const dispatchParams = dispatchCall?.[2] as Record<string, unknown>;
    expect(dispatchParams).not.toHaveProperty('tabId');
    expect(dispatchParams).toMatchObject({
      plugin: 'testplugin',
      tool: 'test_action',
      input: { key: 'val' },
    });
  });

  test('non-numeric tabId is ignored (not extracted, not stripped)', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const validate = vi.fn().mockReturnValue(true);
    const lookup = createMockLookup({ validate });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { tabId: 'not-a-number' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    // Non-numeric tabId is excluded from pluginArgs via destructuring, so tabId is not sent to extension
    const dispatchCall = vi.mocked(dispatchToExtension).mock.calls[0];
    const dispatchParams = dispatchCall?.[2] as Record<string, unknown>;
    expect(dispatchParams).not.toHaveProperty('tabId');
  });

  test.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
  ])('invalid tabId %s is treated as absent (no tab targeting)', async (_label, invalidTabId) => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const validate = vi.fn().mockReturnValue(true);
    const lookup = createMockLookup({ validate });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { tabId: invalidTabId },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    // Invalid tabId is excluded from pluginArgs via destructuring and treated as absent
    const dispatchCall = vi.mocked(dispatchToExtension).mock.calls[0];
    const dispatchParams = dispatchCall?.[2] as Record<string, unknown>;
    expect(dispatchParams).not.toHaveProperty('tabId');
  });

  test('original args object is not mutated', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const originalArgs: Record<string, unknown> = { channel: '#general', tabId: 42 };

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      originalArgs,
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    // The caller's args object must not be modified — tabId should still be present
    expect(originalArgs).toHaveProperty('tabId', 42);
    expect(originalArgs).toHaveProperty('channel', '#general');
  });
});

// ---------------------------------------------------------------------------
// handlePluginInspect tests
// ---------------------------------------------------------------------------

/** Create a minimal RegisteredPlugin for testing */
const createTestPlugin = (overrides: Partial<RegisteredPlugin> = {}): RegisteredPlugin => ({
  name: 'test-plugin',
  version: '1.2.3',
  displayName: 'Test Plugin',
  urlPatterns: ['https://test.example.com/*'],
  excludePatterns: [],
  iife: '(function(){\n  console.log("adapter");\n})()',
  tools: [],
  source: 'local' as const,
  npmPackageName: 'opentabs-plugin-test',
  ...overrides,
});

/** Create a mock state with a plugin registry */
const createStateWithPlugins = (plugins: RegisteredPlugin[]): ServerState => {
  const pluginMap = new Map(plugins.map(p => [p.name, p]));
  return {
    ...createMockState(),
    registry: {
      plugins: pluginMap,
      toolLookup: new Map(),
      failures: [],
    },
  } as unknown as ServerState;
};

describe('handlePluginInspect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns source code, metadata, and review token for valid plugin', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);

    const result = await handlePluginInspect(state, { plugin: 'test-plugin' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
    expect(parsed.plugin).toBe('test-plugin');
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.npmPackage).toBe('opentabs-plugin-test');
    expect(parsed.adapterSource).toBe(plugin.iife);
    expect(parsed.lineCount).toBe(3);
    expect(parsed.byteSize).toBeGreaterThan(0);
    expect(parsed.reviewToken).toBe('mock-review-token-uuid');
    expect(parsed.reviewGuidance).toBe(REVIEW_GUIDANCE);
  });

  test('returns error for unknown plugin', async () => {
    const state = createStateWithPlugins([createTestPlugin()]);

    const result = await handlePluginInspect(state, { plugin: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
    expect(result.content[0]?.text).toContain('test-plugin');
  });

  test('returns error for missing plugin name', async () => {
    const state = createStateWithPlugins([]);

    const result = await handlePluginInspect(state, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('non-empty string');
  });

  test('returns error for empty plugin name', async () => {
    const state = createStateWithPlugins([]);

    const result = await handlePluginInspect(state, { plugin: '' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('non-empty string');
  });

  test('generates review token via generateReviewToken', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);

    await handlePluginInspect(state, { plugin: 'test-plugin' });

    expect(generateReviewToken).toHaveBeenCalledWith(state, 'test-plugin', '1.2.3');
  });

  test('review guidance text is included', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);

    const result = await handlePluginInspect(state, { plugin: 'test-plugin' });

    const parsed = JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
    expect(typeof parsed.reviewGuidance).toBe('string');
    expect(parsed.reviewGuidance as string).toContain('Data exfiltration');
    expect(parsed.reviewGuidance as string).toContain('Code execution vectors');
  });

  test('returns error when plugin has empty IIFE', async () => {
    const plugin = createTestPlugin({ iife: '' });
    const state = createStateWithPlugins([plugin]);

    const result = await handlePluginInspect(state, { plugin: 'test-plugin' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('no adapter IIFE');
  });

  test('omits npmPackage when not set', async () => {
    const plugin = createTestPlugin({ npmPackageName: undefined });
    const state = createStateWithPlugins([plugin]);

    const result = await handlePluginInspect(state, { plugin: 'test-plugin' });

    const parsed = JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
    expect(parsed.npmPackage).toBeUndefined();
  });

  test('omits author when sourcePath is not set', async () => {
    const plugin = createTestPlugin({ sourcePath: undefined });
    const state = createStateWithPlugins([plugin]);

    const result = await handlePluginInspect(state, { plugin: 'test-plugin' });

    const parsed = JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
    expect(parsed.author).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handlePluginMarkReviewed tests
// ---------------------------------------------------------------------------

describe('handlePluginMarkReviewed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateReviewToken).mockReturnValue(true);
  });

  test('succeeds with valid token and sets permission and reviewedVersion', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('test-plugin');
    expect(result.content[0]?.text).toContain('v1.2.3');
    expect(result.content[0]?.text).toContain('reviewed');
    expect(result.content[0]?.text).toContain('"auto"');
    expect(result.content[0]?.text).toContain(
      'Note: This tool should only be called after the user has explicitly confirmed',
    );

    // Verify permission and reviewedVersion were set
    expect(state.pluginPermissions['test-plugin']?.permission).toBe('auto');
    expect(state.pluginPermissions['test-plugin']?.reviewedVersion).toBe('1.2.3');
  });

  test('consumes the review token', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'ask' },
      callbacks,
    );

    expect(consumeReviewToken).toHaveBeenCalledWith(state, 'valid-token');
  });

  test('persists permissions to config', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'auto' },
      callbacks,
    );

    expect(savePluginPermissions).toHaveBeenCalledWith(state, state.pluginPermissions);
  });

  test('calls onToolConfigChanged to emit tools/list_changed', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'auto' },
      callbacks,
    );

    expect(callbacks.onToolConfigChanged).toHaveBeenCalled();
  });

  test('sends plugins.changed notification to extension', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'auto' },
      callbacks,
    );

    expect(sendToExtension).toHaveBeenCalledWith(
      state,
      expect.objectContaining({ method: 'plugins.changed' }) as Record<string, unknown>,
    );
    expect(buildConfigStatePayload).toHaveBeenCalledWith(state);
  });

  test('fails with invalid review token', async () => {
    vi.mocked(validateReviewToken).mockReturnValue(false);
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'bad-token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid or expired review token');
    expect(result.content[0]?.text).toContain('plugin_inspect');
    expect(consumeReviewToken).not.toHaveBeenCalled();
  });

  test('fails with expired token', async () => {
    vi.mocked(validateReviewToken).mockReturnValue(false);
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'expired-token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid or expired review token');
  });

  test('fails with used token', async () => {
    vi.mocked(validateReviewToken).mockReturnValue(false);
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'used-token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid or expired review token');
  });

  test('fails with wrong plugin', async () => {
    vi.mocked(validateReviewToken).mockReturnValue(false);
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'wrong-plugin-token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid or expired review token');
  });

  test('fails with wrong version', async () => {
    vi.mocked(validateReviewToken).mockReturnValue(false);
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '9.9.9', reviewToken: 'wrong-version-token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid or expired review token');
  });

  test('fails for unknown plugin', async () => {
    const state = createStateWithPlugins([createTestPlugin()]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'nonexistent', version: '1.0.0', reviewToken: 'token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
    expect(result.content[0]?.text).toContain('test-plugin');
  });

  test('fails with permission "off"', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'off' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"ask" or "auto"');
  });

  test('fails with missing plugin name', async () => {
    const state = createStateWithPlugins([]);
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { version: '1.0.0', reviewToken: 'token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"plugin" must be a non-empty string');
  });

  test('fails with missing version', async () => {
    const state = createStateWithPlugins([]);
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', reviewToken: 'token', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"version" must be a non-empty string');
  });

  test('fails with missing reviewToken', async () => {
    const state = createStateWithPlugins([]);
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.0.0', permission: 'auto' },
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"reviewToken" must be a non-empty string');
  });

  test('sets permission to "ask" when requested', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    const result = await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'ask' },
      callbacks,
    );

    expect(result.isError).toBeUndefined();
    expect(state.pluginPermissions['test-plugin']?.permission).toBe('ask');
    expect(state.pluginPermissions['test-plugin']?.reviewedVersion).toBe('1.2.3');
    expect(result.content[0]?.text).toContain('"ask"');
  });

  test('preserves existing per-tool permission overrides', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {
      'test-plugin': { permission: 'off', tools: { some_tool: 'auto' } },
    };
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'auto' },
      callbacks,
    );

    expect(state.pluginPermissions['test-plugin']?.tools?.some_tool).toBe('auto');
    expect(state.pluginPermissions['test-plugin']?.permission).toBe('auto');
    expect(state.pluginPermissions['test-plugin']?.reviewedVersion).toBe('1.2.3');
  });
});

// ---------------------------------------------------------------------------
// Instance parameter extraction and resolution tests
// ---------------------------------------------------------------------------

describe('handlePluginToolCall — instance parameter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('instance is stripped from args before Ajv validation', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const validate = vi.fn().mockReturnValue(true);
    const lookup = createMockLookup({ validate });
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { channel: '#general', instance: 'production' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(validate).toHaveBeenCalledTimes(1);
    const validatedArgs = validate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(validatedArgs).toHaveProperty('channel', '#general');
    expect(validatedArgs).not.toHaveProperty('instance');
  });

  test('instance resolves to the correct tab via instanceMap pattern matching', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });

    const pluginMap = new Map([
      [
        'testplugin',
        {
          name: 'testplugin',
          version: '1.0.0',
          instanceMap: {
            production: '*://prod.example.com/*',
            staging: '*://staging.example.com/*',
          },
        },
      ],
    ]) as unknown as ReadonlyMap<string, RegisteredPlugin>;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
    });

    // Mock getMergedTabMapping to return tabs matching the staging instance
    vi.mocked(getMergedTabMapping).mockReturnValue(
      new Map([
        [
          'testplugin',
          {
            state: 'ready' as const,
            tabs: [
              { tabId: 101, url: 'https://prod.example.com/app', title: 'Prod', ready: true },
              { tabId: 202, url: 'https://staging.example.com/app', title: 'Staging', ready: true },
            ],
          },
        ],
      ]),
    );

    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { instance: 'staging' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    // Dispatch should target the staging tab (tabId: 202)
    expect(dispatchToExtension).toHaveBeenCalledWith(
      state,
      'tool.dispatch',
      expect.objectContaining({
        plugin: 'testplugin',
        tool: 'test_action',
        tabId: 202,
      }) as Record<string, unknown>,
      expect.any(Object) as Record<string, unknown>,
    );
  });

  test('instance not open returns error describing which tab is needed', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');

    const pluginMap = new Map([
      [
        'testplugin',
        {
          name: 'testplugin',
          version: '1.0.0',
          instanceMap: {
            production: '*://prod.example.com/*',
            staging: '*://staging.example.com/*',
          },
        },
      ],
    ]) as unknown as ReadonlyMap<string, RegisteredPlugin>;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
    });

    // Only production tab is open, staging is not
    vi.mocked(getMergedTabMapping).mockReturnValue(
      new Map([
        [
          'testplugin',
          {
            state: 'ready' as const,
            tabs: [{ tabId: 101, url: 'https://prod.example.com/app', title: 'Prod', ready: true }],
          },
        ],
      ]),
    );

    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { instance: 'staging' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No open tab found for instance "staging"');
    expect(result.content[0]?.text).toContain('staging');
  });

  test('unknown instance returns error listing valid instances', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');

    const pluginMap = new Map([
      [
        'testplugin',
        {
          name: 'testplugin',
          version: '1.0.0',
          instanceMap: {
            production: '*://prod.example.com/*',
            staging: '*://staging.example.com/*',
          },
        },
      ],
    ]) as unknown as ReadonlyMap<string, RegisteredPlugin>;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
    });

    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { instance: 'nonexistent' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Unknown instance "nonexistent"');
    expect(result.content[0]?.text).toContain('production');
    expect(result.content[0]?.text).toContain('staging');
  });

  test('tabId takes precedence over instance', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });

    const pluginMap = new Map([
      [
        'testplugin',
        {
          name: 'testplugin',
          version: '1.0.0',
          instanceMap: {
            production: '*://prod.example.com/*',
            staging: '*://staging.example.com/*',
          },
        },
      ],
    ]) as unknown as ReadonlyMap<string, RegisteredPlugin>;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
    });

    vi.mocked(getMergedTabMapping).mockReturnValue(
      new Map([
        [
          'testplugin',
          {
            state: 'ready' as const,
            tabs: [
              { tabId: 101, url: 'https://prod.example.com/app', title: 'Prod', ready: true },
              { tabId: 202, url: 'https://staging.example.com/app', title: 'Staging', ready: true },
            ],
          },
        ],
      ]),
    );

    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});

    // Provide both tabId=999 and instance='staging' — tabId should win
    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { tabId: 999, instance: 'staging' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    // Dispatch should use the provided tabId (999), not the staging tab (202)
    expect(dispatchToExtension).toHaveBeenCalledWith(
      state,
      'tool.dispatch',
      expect.objectContaining({
        tabId: 999,
      }) as Record<string, unknown>,
      expect.any(Object) as Record<string, unknown>,
    );

    // A warning should be logged about the conflict
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Both tabId (999) and instance ("staging")'));

    warnSpy.mockRestore();
  });

  test('no instance on multi-instance plugin uses auto-select (no tabId override)', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });

    const pluginMap = new Map([
      [
        'testplugin',
        {
          name: 'testplugin',
          version: '1.0.0',
          instanceMap: {
            production: '*://prod.example.com/*',
            staging: '*://staging.example.com/*',
          },
        },
      ],
    ]) as unknown as ReadonlyMap<string, RegisteredPlugin>;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
    });

    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    // No instance parameter provided — auto-select should work as before
    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    // Dispatch should NOT have a tabId (auto-select)
    const dispatchCall = vi.mocked(dispatchToExtension).mock.calls[0];
    const dispatchParams = dispatchCall?.[2] as Record<string, unknown>;
    expect(dispatchParams).not.toHaveProperty('tabId');
  });

  test('instance prefers ready tabs over non-ready tabs', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });

    const pluginMap = new Map([
      [
        'testplugin',
        {
          name: 'testplugin',
          version: '1.0.0',
          instanceMap: {
            production: '*://prod.example.com/*',
          },
        },
      ],
    ]) as unknown as ReadonlyMap<string, RegisteredPlugin>;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
    });

    // Two tabs for the same instance — one not ready, one ready
    vi.mocked(getMergedTabMapping).mockReturnValue(
      new Map([
        [
          'testplugin',
          {
            state: 'ready' as const,
            tabs: [
              { tabId: 100, url: 'https://prod.example.com/page1', title: 'Prod (loading)', ready: false },
              { tabId: 200, url: 'https://prod.example.com/page2', title: 'Prod (ready)', ready: true },
            ],
          },
        ],
      ]),
    );

    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { instance: 'production' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    // Should select the ready tab (200), not the non-ready one (100)
    expect(dispatchToExtension).toHaveBeenCalledWith(
      state,
      'tool.dispatch',
      expect.objectContaining({ tabId: 200 }) as Record<string, unknown>,
      expect.any(Object) as Record<string, unknown>,
    );
  });

  test('port-aware instance matching: same hostname different ports are distinguished', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });

    const pluginMap = new Map([
      [
        'testplugin',
        {
          name: 'testplugin',
          version: '1.0.0',
          instanceMap: {
            alpha: '*://localhost:3000/*',
            beta: '*://localhost:3001/*',
          },
        },
      ],
    ]) as unknown as ReadonlyMap<string, RegisteredPlugin>;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
    });

    vi.mocked(getMergedTabMapping).mockReturnValue(
      new Map([
        [
          'testplugin',
          {
            state: 'ready' as const,
            tabs: [
              { tabId: 301, url: 'http://localhost:3000/app', title: 'Alpha', ready: true },
              { tabId: 302, url: 'http://localhost:3001/app', title: 'Beta', ready: true },
            ],
          },
        ],
      ]),
    );

    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { instance: 'beta' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(dispatchToExtension).toHaveBeenCalledWith(
      state,
      'tool.dispatch',
      expect.objectContaining({ tabId: 302 }) as Record<string, unknown>,
      expect.any(Object) as Record<string, unknown>,
    );
  });

  test('port-aware instance matching: tab on wrong port does not match', async () => {
    vi.mocked(getToolPermission).mockReturnValue('auto');

    const pluginMap = new Map([
      [
        'testplugin',
        {
          name: 'testplugin',
          version: '1.0.0',
          instanceMap: {
            alpha: '*://localhost:3000/*',
          },
        },
      ],
    ]) as unknown as ReadonlyMap<string, RegisteredPlugin>;
    const state = createMockState({
      registry: { plugins: pluginMap, toolLookup: new Map(), failures: [] },
    });

    // Tab is on port 3001 but instance pattern is for port 3000
    vi.mocked(getMergedTabMapping).mockReturnValue(
      new Map([
        [
          'testplugin',
          {
            state: 'ready' as const,
            tabs: [{ tabId: 400, url: 'http://localhost:3001/app', title: 'Wrong port', ready: true }],
          },
        ],
      ]),
    );

    const lookup = createMockLookup();
    const extra = createMockExtra();
    const callbacks = createMockCallbacks();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { instance: 'alpha' },
      'testplugin',
      'test_action',
      lookup,
      extra,
      callbacks,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No open tab found for instance "alpha"');
  });
});

// ---------------------------------------------------------------------------
// Telemetry: plugin_reviewed event
// ---------------------------------------------------------------------------

describe('telemetry: plugin_reviewed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateReviewToken).mockReturnValue(true);
  });

  test('plugin_reviewed is emitted with permission_set auto', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'auto' },
      callbacks,
    );

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_reviewed', {
      session_id: 'test-session-id',
      permission_set: 'auto',
      review_source: 'agent',
    });
  });

  test('plugin_reviewed is emitted with permission_set ask', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'ask' },
      callbacks,
    );

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_reviewed', {
      session_id: 'test-session-id',
      permission_set: 'ask',
      review_source: 'agent',
    });
  });

  test('plugin_reviewed is not emitted on invalid token', async () => {
    vi.mocked(validateReviewToken).mockReturnValue(false);
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'bad-token', permission: 'auto' },
      callbacks,
    );

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  test('plugin_reviewed event does not include privacy-violating fields', async () => {
    const plugin = createTestPlugin();
    const state = createStateWithPlugins([plugin]);
    state.pluginPermissions = {};
    const callbacks = createMockCallbacks();

    await handlePluginMarkReviewed(
      state,
      { plugin: 'test-plugin', version: '1.2.3', reviewToken: 'valid-token', permission: 'auto' },
      callbacks,
    );

    const calls = mockTrackEvent.mock.calls;
    for (const [, props] of calls) {
      const p = props as Record<string, unknown>;
      expect(p).not.toHaveProperty('plugin_name');
      expect(p).not.toHaveProperty('plugin');
      expect(p).not.toHaveProperty('version');
      expect(p).not.toHaveProperty('review_token');
    }
  });
});
