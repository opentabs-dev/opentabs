import {
  ToolError,
  defineTool,
  validatePluginName,
  validateUrlPattern,
  NAME_REGEX,
  RESERVED_NAMES,
  LUCIDE_ICON_NAMES,
} from './index.js';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { ErrorCategory, LucideIconName, ToolHandlerContext, ProgressOptions } from './index.js';

describe('ToolError', () => {
  test('constructor sets message, code, and name', () => {
    const err = new ToolError('Channel not found', 'CHANNEL_NOT_FOUND');
    expect(err.message).toBe('Channel not found');
    expect(err.code).toBe('CHANNEL_NOT_FOUND');
    expect(err.name).toBe('ToolError');
  });

  test('instanceof Error returns true', () => {
    const err = new ToolError('fail', 'ERR');
    expect(err).toBeInstanceOf(Error);
  });

  test('defaults retryable to false when opts not provided', () => {
    const err = new ToolError('fail', 'ERR');
    expect(err.retryable).toBe(false);
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.category).toBeUndefined();
  });

  test('defaults retryable to false when opts is empty', () => {
    const err = new ToolError('fail', 'ERR', {});
    expect(err.retryable).toBe(false);
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.category).toBeUndefined();
  });

  test('accepts retryable=true', () => {
    const err = new ToolError('rate limited', 'RATE_LIMITED', { retryable: true });
    expect(err.retryable).toBe(true);
  });

  test('accepts retryAfterMs', () => {
    const err = new ToolError('rate limited', 'RATE_LIMITED', { retryable: true, retryAfterMs: 5000 });
    expect(err.retryAfterMs).toBe(5000);
  });

  test('accepts all category values', () => {
    const categories: ErrorCategory[] = ['auth', 'rate_limit', 'not_found', 'validation', 'internal', 'timeout'];
    for (const category of categories) {
      const err = new ToolError('fail', 'ERR', { category });
      expect(err.category).toBe(category);
    }
  });

  test('accepts all opts together', () => {
    const err = new ToolError('too many requests', 'RATE_LIMITED', {
      retryable: true,
      retryAfterMs: 3000,
      category: 'rate_limit',
    });
    expect(err.message).toBe('too many requests');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(3000);
    expect(err.category).toBe('rate_limit');
  });

  test('fields are readonly', () => {
    const err = new ToolError('fail', 'ERR', { retryable: true, retryAfterMs: 1000, category: 'auth' });
    // TypeScript enforces readonly at compile time; verify values are set correctly
    expect(err.code).toBe('ERR');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(1000);
    expect(err.category).toBe('auth');
  });

  describe('factory methods', () => {
    test('ToolError.auth() creates an auth error', () => {
      const err = ToolError.auth('Not authenticated');
      expect(err).toBeInstanceOf(ToolError);
      expect(err.message).toBe('Not authenticated');
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.category).toBe('auth');
      expect(err.retryable).toBe(false);
      expect(err.retryAfterMs).toBeUndefined();
    });

    test('ToolError.notFound() creates a not-found error with default code', () => {
      const err = ToolError.notFound('Channel does not exist');
      expect(err).toBeInstanceOf(ToolError);
      expect(err.message).toBe('Channel does not exist');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.category).toBe('not_found');
      expect(err.retryable).toBe(false);
      expect(err.retryAfterMs).toBeUndefined();
    });

    test('ToolError.notFound() accepts a custom code', () => {
      const err = ToolError.notFound('Channel does not exist', 'CHANNEL_NOT_FOUND');
      expect(err.code).toBe('CHANNEL_NOT_FOUND');
      expect(err.category).toBe('not_found');
      expect(err.retryable).toBe(false);
    });

    test('ToolError.rateLimited() creates a retryable rate-limit error', () => {
      const err = ToolError.rateLimited('Too many requests');
      expect(err).toBeInstanceOf(ToolError);
      expect(err.message).toBe('Too many requests');
      expect(err.code).toBe('RATE_LIMITED');
      expect(err.category).toBe('rate_limit');
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBeUndefined();
    });

    test('ToolError.rateLimited() accepts retryAfterMs', () => {
      const err = ToolError.rateLimited('Too many requests', 5000);
      expect(err.retryAfterMs).toBe(5000);
      expect(err.retryable).toBe(true);
    });

    test('ToolError.validation() creates a validation error', () => {
      const err = ToolError.validation('Invalid input');
      expect(err).toBeInstanceOf(ToolError);
      expect(err.message).toBe('Invalid input');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.category).toBe('validation');
      expect(err.retryable).toBe(false);
      expect(err.retryAfterMs).toBeUndefined();
    });

    test('ToolError.timeout() creates a retryable timeout error', () => {
      const err = ToolError.timeout('Request timed out');
      expect(err).toBeInstanceOf(ToolError);
      expect(err.message).toBe('Request timed out');
      expect(err.code).toBe('TIMEOUT');
      expect(err.category).toBe('timeout');
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBeUndefined();
    });

    test('ToolError.internal() creates an internal error', () => {
      const err = ToolError.internal('Unexpected failure');
      expect(err).toBeInstanceOf(ToolError);
      expect(err.message).toBe('Unexpected failure');
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.category).toBe('internal');
      expect(err.retryable).toBe(false);
      expect(err.retryAfterMs).toBeUndefined();
    });
  });
});

describe('defineTool', () => {
  const input = z.object({ msg: z.string() });
  const output = z.object({ ok: z.boolean() });

  const tool = defineTool({
    name: 'send_message',
    displayName: 'Send Message',
    description: 'Send a message',
    icon: 'send',
    input,
    output,
    handle: () => Promise.resolve({ ok: true }),
  });

  test('returns the same config object passed in (identity function)', () => {
    const config = {
      name: 'test_tool',
      displayName: 'Test Tool',
      description: 'A test tool',
      icon: 'wrench' as const,
      input,
      output,
      handle: () => Promise.resolve({ ok: true }),
    };
    expect(defineTool(config)).toBe(config);
  });

  test('returned object has name, displayName, description, icon, input, output, handle properties', () => {
    expect(tool.name).toBe('send_message');
    expect(tool.displayName).toBe('Send Message');
    expect(tool.description).toBe('Send a message');
    expect(tool.icon).toBe('send');
    expect(tool.input).toBe(input);
    expect(tool.output).toBe(output);
    expect(typeof tool.handle).toBe('function');
  });
});

describe('ToolHandlerContext', () => {
  const input = z.object({ value: z.number() });
  const output = z.object({ result: z.number() });

  test('defineTool accepts a handler with no context parameter', () => {
    const tool = defineTool({
      name: 'no_context',
      displayName: 'No Context',
      description: 'Tool without context',
      icon: 'wrench',
      input,
      output,
      handle: params => Promise.resolve({ result: params.value * 2 }),
    });
    expect(typeof tool.handle).toBe('function');
  });

  test('defineTool accepts a handler with an optional context parameter', () => {
    const tool = defineTool({
      name: 'with_context',
      displayName: 'With Context',
      description: 'Tool with context',
      icon: 'wrench',
      input,
      output,
      handle: (params, context?) => {
        context?.reportProgress({ progress: 1, total: 1 });
        return Promise.resolve({ result: params.value * 2 });
      },
    });
    expect(typeof tool.handle).toBe('function');
  });

  test('handle can be called without context (backward-compatible)', async () => {
    const tool = defineTool({
      name: 'compat',
      displayName: 'Compat',
      description: 'Backward-compatible tool',
      icon: 'wrench',
      input,
      output,
      handle: params => Promise.resolve({ result: params.value + 1 }),
    });
    const result = await tool.handle({ value: 5 });
    expect(result).toEqual({ result: 6 });
  });

  test('handle can be called with a context object', async () => {
    const progressCalls: ProgressOptions[] = [];
    const ctx: ToolHandlerContext = {
      reportProgress: opts => {
        progressCalls.push(opts);
      },
    };

    const tool = defineTool({
      name: 'progress_tool',
      displayName: 'Progress Tool',
      description: 'Tool that reports progress',
      icon: 'wrench',
      input,
      output,
      handle: (params, context?) => {
        context?.reportProgress({ progress: 1, total: 3, message: 'Step 1' });
        context?.reportProgress({ progress: 2, total: 3, message: 'Step 2' });
        context?.reportProgress({ progress: 3, total: 3, message: 'Done' });
        return Promise.resolve({ result: params.value });
      },
    });

    const result = await tool.handle({ value: 42 }, ctx);
    expect(result).toEqual({ result: 42 });
    expect(progressCalls).toEqual([
      { progress: 1, total: 3, message: 'Step 1' },
      { progress: 2, total: 3, message: 'Step 2' },
      { progress: 3, total: 3, message: 'Done' },
    ]);
  });

  test('reportProgress is fire-and-forget (does not affect result)', async () => {
    const ctx: ToolHandlerContext = {
      reportProgress: () => {
        throw new Error('progress handler error');
      },
    };

    const tool = defineTool({
      name: 'resilient',
      displayName: 'Resilient',
      description: 'Tool with failing progress',
      icon: 'wrench',
      input,
      output,
      handle: (params, context?) => {
        try {
          context?.reportProgress({ progress: 1, total: 1 });
        } catch {
          // fire-and-forget: tool continues despite progress errors
        }
        return Promise.resolve({ result: params.value });
      },
    });

    const result = await tool.handle({ value: 7 }, ctx);
    expect(result).toEqual({ result: 7 });
  });

  test('ProgressOptions accepts progress and total without message', () => {
    const opts: ProgressOptions = { progress: 5, total: 10 };
    expect(opts.progress).toBe(5);
    expect(opts.total).toBe(10);
    expect(opts.message).toBeUndefined();
  });

  test('ProgressOptions accepts progress, total, and message', () => {
    const opts: ProgressOptions = { progress: 3, total: 10, message: 'Processing...' };
    expect(opts.progress).toBe(3);
    expect(opts.total).toBe(10);
    expect(opts.message).toBe('Processing...');
  });

  test('ProgressOptions supports indeterminate progress (message only)', () => {
    const opts: ProgressOptions = { message: 'Loading...' };
    expect(opts.progress).toBeUndefined();
    expect(opts.total).toBeUndefined();
    expect(opts.message).toBe('Loading...');
  });

  test('ProgressOptions supports empty object for indeterminate progress', () => {
    const opts: ProgressOptions = {};
    expect(opts.progress).toBeUndefined();
    expect(opts.total).toBeUndefined();
    expect(opts.message).toBeUndefined();
  });

  test('handle can report indeterminate progress (message only)', async () => {
    const progressCalls: ProgressOptions[] = [];
    const ctx: ToolHandlerContext = {
      reportProgress: opts => {
        progressCalls.push(opts);
      },
    };

    const tool = defineTool({
      name: 'indeterminate_tool',
      description: 'Tool with indeterminate progress',
      input: z.object({ value: z.number() }),
      output: z.object({ result: z.number() }),
      handle: (params, context?) => {
        context?.reportProgress({ message: 'Processing...' });
        context?.reportProgress({ message: 'Almost done...' });
        return Promise.resolve({ result: params.value });
      },
    });

    const result = await tool.handle({ value: 10 }, ctx);
    expect(result).toEqual({ result: 10 });
    expect(progressCalls).toEqual([{ message: 'Processing...' }, { message: 'Almost done...' }]);
  });
});

describe('LucideIconName and LUCIDE_ICON_NAMES', () => {
  test('LUCIDE_ICON_NAMES is a Set with over 1000 entries', () => {
    expect(LUCIDE_ICON_NAMES).toBeInstanceOf(Set);
    expect(LUCIDE_ICON_NAMES.size).toBeGreaterThan(1000);
  });

  test('common icon names are included', () => {
    expect(LUCIDE_ICON_NAMES.has('send')).toBe(true);
    expect(LUCIDE_ICON_NAMES.has('search')).toBe(true);
    expect(LUCIDE_ICON_NAMES.has('wrench')).toBe(true);
    expect(LUCIDE_ICON_NAMES.has('chevron-down')).toBe(true);
  });

  test('LucideIconName type accepts valid icon names', () => {
    const name: LucideIconName = 'send';
    expect(LUCIDE_ICON_NAMES.has(name)).toBe(true);
  });
});

describe('re-exports from @opentabs-dev/shared', () => {
  test('validatePluginName is a function', () => {
    expect(typeof validatePluginName).toBe('function');
  });

  test('validateUrlPattern is a function', () => {
    expect(typeof validateUrlPattern).toBe('function');
  });

  test('NAME_REGEX is a RegExp', () => {
    expect(NAME_REGEX).toBeInstanceOf(RegExp);
  });

  test('RESERVED_NAMES is a Set', () => {
    expect(RESERVED_NAMES).toBeInstanceOf(Set);
  });
});
