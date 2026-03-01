import {
  dispatchToExtension,
  isDispatchError,
  sendInvocationStart,
  sendInvocationEnd,
  sendConfirmationRequest,
} from './extension-protocol.js';
import {
  sanitizeOutput,
  formatStructuredError,
  formatZodError,
  truncateParamsPreview,
  handleBrowserToolCall,
  handlePluginToolCall,
} from './mcp-tool-dispatch.js';
import { evaluatePermission } from './permissions.js';
import { isBrowserToolEnabled, appendAuditEntry, isSessionAllowed } from './state.js';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { RequestHandlerExtra } from './mcp-tool-dispatch.js';
import type { ServerState, CachedBrowserTool, ToolLookupEntry } from './state.js';

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

describe('truncateParamsPreview', () => {
  test('short args passthrough without truncation', () => {
    const args = { key: 'value' };
    const json = JSON.stringify(args, null, 2);
    expect(json.length).toBeLessThanOrEqual(200);
    expect(truncateParamsPreview(args)).toBe(json);
  });

  test('truncates at 200 characters and appends ellipsis', () => {
    const args = { data: 'x'.repeat(300) };
    const result = truncateParamsPreview(args);
    const json = JSON.stringify(args, null, 2);
    expect(result).toBe(json.slice(0, 200) + '…');
  });

  test('does not truncate when json is exactly 200 chars', () => {
    const prefix = '{\n  "data": "';
    const suffix = '"\n}';
    const valueLen = 200 - prefix.length - suffix.length;
    const args = { data: 'x'.repeat(valueLen) };
    const json = JSON.stringify(args, null, 2);
    expect(json).toHaveLength(200);
    expect(truncateParamsPreview(args)).toBe(json);
  });
});

// ---------------------------------------------------------------------------
// Mocks for handler tests (handleBrowserToolCall, handlePluginToolCall)
// ---------------------------------------------------------------------------

vi.mock('./extension-protocol.js', () => ({
  dispatchToExtension: vi.fn(),
  isDispatchError: vi.fn(),
  sendInvocationStart: vi.fn(),
  sendInvocationEnd: vi.fn(),
  sendConfirmationRequest: vi.fn(),
}));

vi.mock('./permissions.js', () => ({
  evaluatePermission: vi.fn(),
}));

vi.mock('./state.js', () => ({
  isBrowserToolEnabled: vi.fn(),
  appendAuditEntry: vi.fn(),
  isSessionAllowed: vi.fn(),
}));

vi.mock('./sanitize-error.js', () => ({
  sanitizeErrorMessage: vi.fn((msg: string) => msg),
}));

vi.mock('./logger.js', () => ({
  log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/** Create a minimal mock ServerState for handler tests */
const createMockState = (overrides: Partial<ServerState> = {}): ServerState =>
  ({
    extensionWs: { send: vi.fn(), close: vi.fn() },
    activeDispatches: new Map<string, number>(),
    auditLog: [],
    sessionPermissions: [],
    skipConfirmation: false,
    permissions: {
      trustedDomains: ['localhost'],
      sensitiveDomains: [],
      toolPolicy: {},
      domainToolPolicy: {},
    },
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

  test('disabled tool returns isError', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(false);
    const state = createMockState();
    const bt = createMockBrowserTool();
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('disabled via configuration');
  });

  test('Zod validation failure returns isError with formatted message', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({ url: z.string() }) });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', { url: 123 }, bt, extra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
  });

  test('permission denied returns isError with PERMISSION_DENIED', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('deny');
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}) });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('PERMISSION_DENIED');
  });

  test('permission denied includes domain in message when domain is present', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('deny');
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({ url: z.string().optional() }) });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(
      state,
      'browser_test_tool',
      { url: 'https://example.com/page' },
      bt,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('example.com');
  });

  test('permission allow skips confirmation and executes handler', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('allow');
    const handler = vi.fn().mockResolvedValue({ data: 'hello' });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('"data"');
    expect(result.content[0]?.text).toContain('"hello"');
    expect(sendConfirmationRequest).not.toHaveBeenCalled();
  });

  test('session allowed skips permission evaluation and confirmation', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(true);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBeUndefined();
    expect(evaluatePermission).not.toHaveBeenCalled();
    expect(sendConfirmationRequest).not.toHaveBeenCalled();
  });

  test('permission ask with deny decision returns PERMISSION_DENIED', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue('deny');
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}) });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('PERMISSION_DENIED');
    expect(result.content[0]?.text).toContain('user denied');
  });

  test('permission ask with allow_once decision executes handler', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue('allow_once');
    const handler = vi.fn().mockResolvedValue({ dispatched: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
  });

  test('permission ask with allow_always decision executes handler', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue('allow_always');
    const handler = vi.fn().mockResolvedValue({ dispatched: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
  });

  test('confirmation timeout returns CONFIRMATION_TIMEOUT', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockRejectedValue(new Error('CONFIRMATION_TIMEOUT'));
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}) });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('CONFIRMATION_TIMEOUT');
  });

  test('confirmation error returns confirmation error message', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockRejectedValue(new Error('Extension not connected'));
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}) });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Confirmation error');
    expect(result.content[0]?.text).toContain('Extension not connected');
  });

  test('successful execution returns sanitized output (dangerous keys stripped)', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(true);
    const handler = vi.fn().mockResolvedValue({ safe: 'value', __proto__: 'bad' });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toHaveProperty('safe', 'value');
    expect(parsed).not.toHaveProperty('__proto__');
  });

  test('handler error returns "Browser tool error:" message', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(true);
    const handler = vi.fn().mockRejectedValue(new Error('tab crashed'));
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();

    const result = await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Browser tool error: tab crashed');
  });

  test('audit entry recorded on success', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(true);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();

    await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

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
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(true);
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const extra = createMockExtra();

    await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(appendAuditEntry).toHaveBeenCalledTimes(1);
    const entry = (vi.mocked(appendAuditEntry).mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry).toMatchObject({
      tool: 'browser_test_tool',
      plugin: 'browser',
      success: false,
      error: { code: 'UNKNOWN', message: 'boom' },
    });
  });

  test('ask permission with progressToken sends progress notification', async () => {
    vi.mocked(isBrowserToolEnabled).mockReturnValue(true);
    vi.mocked(isSessionAllowed).mockReturnValue(false);
    vi.mocked(evaluatePermission).mockReturnValue('ask');
    vi.mocked(sendConfirmationRequest).mockResolvedValue('allow_once');
    const handler = vi.fn().mockResolvedValue({});
    const state = createMockState();
    const bt = createMockBrowserTool({ schema: z.object({}), handler });
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra = createMockExtra({
      _meta: { progressToken: 'tok-1' },
      sendNotification,
    });

    await handleBrowserToolCall(state, 'browser_test_tool', {}, bt, extra);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progressToken: 'tok-1',
          message: expect.stringContaining('approval') as string,
        }) as Record<string, unknown>,
      }),
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

  test('schema compilation failure (validate is null) returns error', async () => {
    const state = createMockState();
    const lookup = createMockLookup({
      validate: null,
      validationErrors: vi.fn().mockReturnValue('Schema compilation error'),
    });
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('schema compilation failed');
  });

  test('validator throws returns "validation failed unexpectedly"', async () => {
    const state = createMockState();
    const lookup = createMockLookup({
      validate: vi.fn().mockImplementation(() => {
        throw new Error('catastrophic backtracking');
      }),
    });
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('validation failed unexpectedly');
  });

  test('validation failure returns "Invalid arguments" with errors', async () => {
    const state = createMockState();
    const lookup = createMockLookup({
      validate: vi.fn().mockReturnValue(false),
      validationErrors: vi.fn().mockReturnValue('missing required field "channel"'),
    });
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
    expect(result.content[0]?.text).toContain('missing required field "channel"');
  });

  test('concurrency limit exceeded returns error', async () => {
    const state = createMockState();
    state.activeDispatches.set('testplugin', 5);
    const lookup = createMockLookup();
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Too many concurrent dispatches');
    expect(result.content[0]?.text).toContain('testplugin');
  });

  test('extension not connected returns error', async () => {
    const state = createMockState({ extensionWs: null });
    const lookup = createMockLookup();
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Extension not connected');
  });

  test('successful dispatch returns sanitized output', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: { id: '123', name: 'test' } });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { key: 'val' },
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('"id"');
    expect(result.content[0]?.text).toContain('"123"');
  });

  test('successful dispatch sanitizes dangerous keys from output', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: { safe: 1, __proto__: 'bad', constructor: 'bad' } });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toHaveProperty('safe', 1);
    expect(parsed).not.toHaveProperty('__proto__');
    expect(parsed).not.toHaveProperty('constructor');
  });

  test('dispatch result without output field uses raw result', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValue({ directResult: true });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed).toHaveProperty('directResult', true);
  });

  test('DispatchError with code -32001 prefixes "Tab closed:"', async () => {
    const err = Object.assign(new Error('tab was closed'), { name: 'DispatchError', code: -32001, data: undefined });
    vi.mocked(dispatchToExtension).mockRejectedValue(err);
    vi.mocked(isDispatchError).mockReturnValue(true);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tab closed:');
  });

  test('DispatchError with code -32002 prefixes "Tab unavailable:"', async () => {
    const err = Object.assign(new Error('plugin not loaded'), { name: 'DispatchError', code: -32002, data: undefined });
    vi.mocked(dispatchToExtension).mockRejectedValue(err);
    vi.mocked(isDispatchError).mockReturnValue(true);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tab unavailable:');
  });

  test('DispatchError with data.code (ToolError) formats structured error', async () => {
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

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[ERROR code=RATE_LIMITED');
    expect(text).toContain('category=rate_limit');
    expect(text).toContain('retryable=true');
    expect(text).toContain('retryAfterMs=5000');
  });

  test('DispatchError with data.code only (no structured fields) uses legacy format', async () => {
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

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('[SOME_ERROR] something wrong');
  });

  test('generic non-dispatch error returns "Tool dispatch error:" message', async () => {
    vi.mocked(dispatchToExtension).mockRejectedValue(new Error('network failure'));
    vi.mocked(isDispatchError).mockReturnValue(false);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    const result = await handlePluginToolCall(
      state,
      'testplugin_test_action',
      {},
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tool dispatch error:');
    expect(result.content[0]?.text).toContain('network failure');
  });

  test('activeDispatches counter increments and decrements correctly', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    expect(state.activeDispatches.get('testplugin')).toBeUndefined();
    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);
    // After completion, counter should be cleaned up (deleted when reaches 0)
    expect(state.activeDispatches.has('testplugin')).toBe(false);
  });

  test('activeDispatches counter decrements on error', async () => {
    vi.mocked(dispatchToExtension).mockRejectedValue(new Error('fail'));
    vi.mocked(isDispatchError).mockReturnValue(false);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);
    expect(state.activeDispatches.has('testplugin')).toBe(false);
  });

  test('sendInvocationStart and sendInvocationEnd are called', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);

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
    vi.mocked(dispatchToExtension).mockRejectedValue(new Error('fail'));
    vi.mocked(isDispatchError).mockReturnValue(false);
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);

    expect(sendInvocationEnd).toHaveBeenCalledWith(
      state,
      'testplugin',
      'test_action',
      expect.any(Number) as number,
      false,
    );
  });

  test('audit entry recorded on success', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);

    expect(appendAuditEntry).toHaveBeenCalledTimes(1);
    const entry = (vi.mocked(appendAuditEntry).mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry).toMatchObject({
      tool: 'testplugin_test_action',
      plugin: 'testplugin',
      success: true,
    });
  });

  test('audit entry recorded on failure with error info', async () => {
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

    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);

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
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra({ _meta: { progressToken: 'prog-1' } });

    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);

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
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra(); // no _meta

    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);

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
    const state = createMockState({ extensionWs: null });
    const lookup = createMockLookup();
    const extra = createMockExtra();

    await handlePluginToolCall(state, 'testplugin_test_action', {}, 'testplugin', 'test_action', lookup, extra);

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
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const validate = vi.fn().mockReturnValue(true);
    const lookup = createMockLookup({ validate });
    const extra = createMockExtra();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { channel: '#general', tabId: 42 },
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    // Ajv validate should have been called with args that do NOT contain tabId
    expect(validate).toHaveBeenCalledTimes(1);
    const validatedArgs = validate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(validatedArgs).toHaveProperty('channel', '#general');
    expect(validatedArgs).not.toHaveProperty('tabId');
  });

  test('tabId is threaded as top-level param to dispatchToExtension', async () => {
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { key: 'val', tabId: 123 },
      'testplugin',
      'test_action',
      lookup,
      extra,
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
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const lookup = createMockLookup();
    const extra = createMockExtra();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { key: 'val' },
      'testplugin',
      'test_action',
      lookup,
      extra,
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
    vi.mocked(dispatchToExtension).mockResolvedValue({ output: {} });
    const state = createMockState();
    const validate = vi.fn().mockReturnValue(true);
    const lookup = createMockLookup({ validate });
    const extra = createMockExtra();

    await handlePluginToolCall(
      state,
      'testplugin_test_action',
      { tabId: 'not-a-number' },
      'testplugin',
      'test_action',
      lookup,
      extra,
    );

    // Non-numeric tabId is deleted from args before validation (delete is unconditional after extract)
    // but the extract yields undefined, so tabId is not sent to extension
    const dispatchCall = vi.mocked(dispatchToExtension).mock.calls[0];
    const dispatchParams = dispatchCall?.[2] as Record<string, unknown>;
    expect(dispatchParams).not.toHaveProperty('tabId');
  });
});
