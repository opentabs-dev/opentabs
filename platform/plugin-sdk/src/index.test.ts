import {
  ToolError,
  defineTool,
  defineResource,
  definePrompt,
  validatePluginName,
  validateUrlPattern,
  NAME_REGEX,
  RESERVED_NAMES,
  LUCIDE_ICON_NAMES,
} from './index.js';
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type {
  ErrorCategory,
  LucideIconName,
  ToolHandlerContext,
  ProgressOptions,
  ResourceContent,
  ResourceDefinition,
  PromptArgument,
  PromptMessage,
  PromptDefinition,
} from './index.js';

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

describe('defineResource', () => {
  test('returns the same config object passed in (identity function)', () => {
    const config: ResourceDefinition = {
      uri: 'test://items',
      name: 'Items',
      description: 'List of items',
      mimeType: 'application/json',
      read: () => Promise.resolve({ uri: 'test://items', text: '[]' }),
    };
    expect(defineResource(config)).toBe(config);
  });

  test('returned object has uri, name, description, mimeType, read properties', () => {
    const resource = defineResource({
      uri: 'test://data',
      name: 'Data',
      description: 'Test data',
      mimeType: 'text/plain',
      read: () => Promise.resolve({ uri: 'test://data', text: 'hello' }),
    });
    expect(resource.uri).toBe('test://data');
    expect(resource.name).toBe('Data');
    expect(resource.description).toBe('Test data');
    expect(resource.mimeType).toBe('text/plain');
    expect(typeof resource.read).toBe('function');
  });

  test('description and mimeType are optional', () => {
    const resource = defineResource({
      uri: 'test://minimal',
      name: 'Minimal',
      read: () => Promise.resolve({ uri: 'test://minimal', text: '' }),
    });
    expect(resource.description).toBeUndefined();
    expect(resource.mimeType).toBeUndefined();
  });

  test('read() returns ResourceContent with text', async () => {
    const resource = defineResource({
      uri: 'test://text',
      name: 'Text Resource',
      read: uri => Promise.resolve({ uri, text: 'content here', mimeType: 'text/plain' }),
    });
    const result = await resource.read('test://text');
    expect(result).toEqual({ uri: 'test://text', text: 'content here', mimeType: 'text/plain' });
  });

  test('read() returns ResourceContent with blob', async () => {
    const resource = defineResource({
      uri: 'test://binary',
      name: 'Binary Resource',
      mimeType: 'image/png',
      read: uri => Promise.resolve({ uri, blob: 'iVBORw0KGgo=', mimeType: 'image/png' }),
    });
    const result = await resource.read('test://binary');
    expect(result.blob).toBe('iVBORw0KGgo=');
    expect(result.text).toBeUndefined();
  });
});

describe('definePrompt', () => {
  test('returns the same config object passed in (identity function)', () => {
    const config: PromptDefinition = {
      name: 'greet',
      description: 'Generate a greeting',
      arguments: [{ name: 'name', description: 'Name to greet', required: true }],
      render: args =>
        Promise.resolve([{ role: 'user', content: { type: 'text', text: `Hello, ${String(args['name'])}!` } }]),
    };
    expect(definePrompt(config)).toBe(config);
  });

  test('returned object has name, description, arguments, render properties', () => {
    const prompt = definePrompt({
      name: 'test_prompt',
      description: 'A test prompt',
      arguments: [{ name: 'input' }],
      render: () => Promise.resolve([{ role: 'user', content: { type: 'text', text: 'test' } }]),
    });
    expect(prompt.name).toBe('test_prompt');
    expect(prompt.description).toBe('A test prompt');
    expect(prompt.arguments).toHaveLength(1);
    expect(prompt.arguments?.[0]?.name).toBe('input');
    expect(typeof prompt.render).toBe('function');
  });

  test('description and arguments are optional', () => {
    const prompt = definePrompt({
      name: 'minimal',
      render: () => Promise.resolve([{ role: 'user', content: { type: 'text', text: 'hi' } }]),
    });
    expect(prompt.description).toBeUndefined();
    expect(prompt.arguments).toBeUndefined();
  });

  test('render() returns PromptMessage array', async () => {
    const prompt = definePrompt({
      name: 'greet',
      arguments: [{ name: 'name', required: true }],
      render: args =>
        Promise.resolve([
          { role: 'user', content: { type: 'text', text: `Hello, ${String(args['name'])}!` } },
          { role: 'assistant', content: { type: 'text', text: 'Hi there! How can I help you?' } },
        ]),
    });
    const messages = await prompt.render({ name: 'World' });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: { type: 'text', text: 'Hello, World!' } });
    expect(messages[1]?.role).toBe('assistant');
  });

  test('PromptArgument supports optional fields', () => {
    const arg: PromptArgument = { name: 'query' };
    expect(arg.description).toBeUndefined();
    expect(arg.required).toBeUndefined();

    const fullArg: PromptArgument = { name: 'query', description: 'Search query', required: true };
    expect(fullArg.description).toBe('Search query');
    expect(fullArg.required).toBe(true);
  });

  test('PromptMessage supports user and assistant roles', () => {
    const userMsg: PromptMessage = { role: 'user', content: { type: 'text', text: 'hi' } };
    const assistantMsg: PromptMessage = { role: 'assistant', content: { type: 'text', text: 'hello' } };
    expect(userMsg.role).toBe('user');
    expect(assistantMsg.role).toBe('assistant');
    expect(userMsg.content.type).toBe('text');
  });

  test('definePrompt with args Zod schema provides typed render parameter', async () => {
    const argsSchema = z.object({
      name: z.string().describe('The name to greet'),
      greeting: z.string().optional(),
    });

    const prompt = definePrompt({
      name: 'typed_greet',
      description: 'A typed greeting prompt',
      args: argsSchema,
      render(args) {
        // args is typed as { name: string; greeting?: string }
        const greeting = args.greeting ?? 'Hello';
        return Promise.resolve([{ role: 'user', content: { type: 'text', text: `${greeting}, ${args.name}!` } }]);
      },
    });

    expect(prompt.name).toBe('typed_greet');
    expect(prompt.args).toBe(argsSchema);
    const messages = await prompt.render({ name: 'World' });
    expect(messages).toEqual([{ role: 'user', content: { type: 'text', text: 'Hello, World!' } }]);
  });

  test('definePrompt without args still works with Record<string, string>', async () => {
    const prompt = definePrompt({
      name: 'untyped',
      arguments: [{ name: 'name', required: true }],
      render(args) {
        return Promise.resolve([{ role: 'user', content: { type: 'text', text: `Hi, ${String(args['name'])}!` } }]);
      },
    });

    expect(prompt.args).toBeUndefined();
    const messages = await prompt.render({ name: 'World' });
    expect(messages).toEqual([{ role: 'user', content: { type: 'text', text: 'Hi, World!' } }]);
  });

  test('definePrompt with args and explicit arguments uses both', () => {
    const argsSchema = z.object({ name: z.string() });
    const prompt = definePrompt({
      name: 'both',
      args: argsSchema,
      arguments: [{ name: 'name', description: 'Custom description', required: true }],
      render(args) {
        return Promise.resolve([{ role: 'user', content: { type: 'text', text: args.name } }]);
      },
    });
    expect(prompt.args).toBe(argsSchema);
    expect(prompt.arguments).toHaveLength(1);
  });
});

describe('ResourceContent type', () => {
  test('supports text content', () => {
    const content: ResourceContent = { uri: 'test://a', text: 'hello' };
    expect(content.uri).toBe('test://a');
    expect(content.text).toBe('hello');
    expect(content.blob).toBeUndefined();
  });

  test('supports blob content', () => {
    const content: ResourceContent = { uri: 'test://b', blob: 'base64data' };
    expect(content.blob).toBe('base64data');
    expect(content.text).toBeUndefined();
  });

  test('supports mimeType', () => {
    const content: ResourceContent = { uri: 'test://c', text: '{}', mimeType: 'application/json' };
    expect(content.mimeType).toBe('application/json');
  });
});
