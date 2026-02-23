import {
  checkToolCallable,
  getEnabledToolsList,
  rebuildCachedBrowserTools,
  registerMcpHandlers,
  sanitizeOutput,
} from './mcp-setup.js';
import { buildRegistry, trustTierPrefix } from './registry.js';
import { createState } from './state.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { BrowserToolDefinition } from './browser-tools/definition.js';
import type { McpServerInstance, RequestHandlerExtra } from './mcp-setup.js';
import type { RegisteredPlugin } from './state.js';

/** Create a minimal RegisteredPlugin for testing */
const createPlugin = (name: string, toolNames: string[]): RegisteredPlugin => ({
  name,
  version: '1.0.0',
  displayName: name,
  urlPatterns: [`https://${name}.example.com/*`],
  trustTier: 'local',
  source: 'local' as const,
  iife: `(function(){/* ${name} */})()`,
  tools: toolNames.map(t => ({
    name: t,
    displayName: t,
    description: `${t} description`,
    icon: 'wrench',
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
  })),
  resources: [],
  prompts: [],
});

describe('buildRegistry — plugin tool lookup', () => {
  test('populates toolLookup with correct prefixed names', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);

    expect(state.registry.toolLookup.size).toBe(2);
    expect(state.registry.toolLookup.get('slack_send_message')).toMatchObject({
      pluginName: 'slack',
      toolName: 'send_message',
    });
    expect(state.registry.toolLookup.get('slack_read_messages')).toMatchObject({
      pluginName: 'slack',
      toolName: 'read_messages',
    });
  });

  test('empty plugins produces empty toolLookup', () => {
    const state = createState();
    state.registry = buildRegistry([], []);

    expect(state.registry.toolLookup.size).toBe(0);
  });

  test('multiple plugins produces correct entries for all tools', () => {
    const state = createState();
    state.registry = buildRegistry(
      [createPlugin('slack', ['send_message']), createPlugin('github', ['create_issue', 'list_prs'])],
      [],
    );

    expect(state.registry.toolLookup.size).toBe(3);
    expect(state.registry.toolLookup.get('slack_send_message')).toMatchObject({
      pluginName: 'slack',
      toolName: 'send_message',
    });
    expect(state.registry.toolLookup.get('github_create_issue')).toMatchObject({
      pluginName: 'github',
      toolName: 'create_issue',
    });
    expect(state.registry.toolLookup.get('github_list_prs')).toMatchObject({
      pluginName: 'github',
      toolName: 'list_prs',
    });
  });

  test('replaces previous toolLookup entries on rebuild', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    expect(state.registry.toolLookup.size).toBe(1);

    // Change plugins and rebuild
    state.registry = buildRegistry([createPlugin('github', ['create_issue'])], []);

    expect(state.registry.toolLookup.size).toBe(1);
    expect(state.registry.toolLookup.has('slack_send_message')).toBe(false);
    expect(state.registry.toolLookup.get('github_create_issue')).toMatchObject({
      pluginName: 'github',
      toolName: 'create_issue',
    });
  });
});

describe('rebuildCachedBrowserTools — cached browser tools', () => {
  test('populates cachedBrowserTools with pre-computed JSON schemas', () => {
    const state = createState();
    const browserTool: BrowserToolDefinition = {
      name: 'browser_list_tabs',
      description: 'List all open tabs',
      input: z.object({}),
      handler: () => Promise.resolve([]),
    };
    state.browserTools = [browserTool];

    rebuildCachedBrowserTools(state);

    expect(state.cachedBrowserTools).toHaveLength(1);
    const cachedRaw = state.cachedBrowserTools[0];
    expect(cachedRaw).toBeDefined();
    const cached = cachedRaw as NonNullable<typeof cachedRaw>;
    expect(cached.name).toBe('browser_list_tabs');
    expect(cached.description).toBe('List all open tabs');
    expect(cached.inputSchema).toBeDefined();
    expect(typeof cached.inputSchema).toBe('object');
    expect(cached.tool).toBe(browserTool);
  });

  test('empty browserTools produces empty cachedBrowserTools', () => {
    const state = createState();
    state.browserTools = [];

    rebuildCachedBrowserTools(state);

    expect(state.cachedBrowserTools).toHaveLength(0);
  });

  test('multiple browser tools produce correct cached entries', () => {
    const state = createState();
    state.browserTools = [
      {
        name: 'browser_list_tabs',
        description: 'List tabs',
        input: z.object({}),
        handler: () => Promise.resolve([]),
      },
      {
        name: 'browser_open_tab',
        description: 'Open a tab',
        input: z.object({ url: z.string() }),
        handler: () => Promise.resolve({}),
      },
    ];

    rebuildCachedBrowserTools(state);

    expect(state.cachedBrowserTools).toHaveLength(2);
    const firstCached = state.cachedBrowserTools[0];
    expect(firstCached).toBeDefined();
    expect((firstCached as NonNullable<typeof firstCached>).name).toBe('browser_list_tabs');
    const secondCached = state.cachedBrowserTools[1];
    expect(secondCached).toBeDefined();
    expect((secondCached as NonNullable<typeof secondCached>).name).toBe('browser_open_tab');
    // Verify the input schema has the url property
    const openTabSchema = (secondCached as NonNullable<typeof secondCached>).inputSchema;
    expect(openTabSchema).toHaveProperty('properties');
  });
});

describe('buildRegistry — input validation', () => {
  test('lookup entries include a working validate function', () => {
    const state = createState();
    const plugin: RegisteredPlugin = {
      ...createPlugin('test', ['greet']),
      tools: [
        {
          name: 'greet',
          displayName: 'Greet',
          description: 'Greet a user',
          icon: 'wrench',
          input_schema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
          output_schema: { type: 'object' },
        },
      ],
    };
    state.registry = buildRegistry([plugin], []);

    const entry = state.registry.toolLookup.get('test_greet');
    expect(entry).toBeDefined();
    if (!entry?.validate) throw new Error('Expected validate function');
    expect(entry.validate).toBeInstanceOf(Function);
    // Valid input passes
    expect(entry.validate({ name: 'Alice' })).toBe(true);
    // Missing required field fails
    expect(entry.validate({})).toBe(false);
  });

  test('validationErrors returns human-readable errors after failed validation', () => {
    const state = createState();
    const plugin: RegisteredPlugin = {
      ...createPlugin('test', ['greet']),
      tools: [
        {
          name: 'greet',
          displayName: 'Greet',
          description: 'Greet a user',
          icon: 'wrench',
          input_schema: {
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'number' } },
            required: ['name'],
            additionalProperties: false,
          },
          output_schema: { type: 'object' },
        },
      ],
    };
    state.registry = buildRegistry([plugin], []);

    const entry = state.registry.toolLookup.get('test_greet');
    if (!entry?.validate) throw new Error('Expected entry with validate');
    // Pass wrong type for name
    entry.validate({ name: 123 });
    const errors = entry.validationErrors();
    expect(errors).toContain('/name');
    expect(errors).toContain('string');
  });

  test('validate compiles for trivial schemas and passes empty args', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('test', ['ping'])], []);

    const entry = state.registry.toolLookup.get('test_ping');
    expect(entry).toBeDefined();
    if (!entry?.validate) throw new Error('Expected validate function');
    // { type: 'object' } compiles successfully — validate should still be a function
    expect(entry.validate).toBeInstanceOf(Function);
    // Empty args should pass a { type: 'object' } schema
    expect(entry.validate({})).toBe(true);
  });

  test('additional properties are rejected when additionalProperties is false', () => {
    const state = createState();
    const plugin: RegisteredPlugin = {
      ...createPlugin('test', ['strict']),
      tools: [
        {
          name: 'strict',
          displayName: 'Strict',
          description: 'Strict tool',
          icon: 'wrench',
          input_schema: {
            type: 'object',
            properties: { a: { type: 'string' } },
            additionalProperties: false,
          },
          output_schema: { type: 'object' },
        },
      ],
    };
    state.registry = buildRegistry([plugin], []);

    const entry = state.registry.toolLookup.get('test_strict');
    if (!entry?.validate) throw new Error('Expected entry with validate');
    expect(entry.validate({ a: 'ok' })).toBe(true);
    expect(entry.validate({ a: 'ok', b: 'extra' })).toBe(false);
  });
});

describe('trustTierPrefix', () => {
  test('returns correct prefix for official tier', () => {
    expect(trustTierPrefix('official')).toBe('[Official] ');
  });

  test('returns correct prefix for community tier', () => {
    expect(trustTierPrefix('community')).toBe('[Community plugin — unverified] ');
  });

  test('returns correct prefix for local tier', () => {
    expect(trustTierPrefix('local')).toBe('[Local plugin] ');
  });
});

/** Handler type matching the McpServerInstance.setRequestHandler callback */
type RequestHandler = (
  request: { params: { name: string; arguments?: Record<string, unknown>; uri?: string } },
  extra: RequestHandlerExtra,
) => unknown;

/** Create a mock McpServerInstance that captures registered handlers */
const createMockServer = (): {
  server: McpServerInstance;
  handlers: Map<unknown, RequestHandler>;
} => {
  const handlers = new Map<unknown, RequestHandler>();
  const server: McpServerInstance = {
    setRequestHandler: (schema: unknown, handler) => {
      handlers.set(schema, handler);
    },
    connect: () => Promise.resolve(),
    sendToolListChanged: () => Promise.resolve(),
    sendResourceListChanged: () => Promise.resolve(),
    sendPromptListChanged: () => Promise.resolve(),
    sendLoggingMessage: () => Promise.resolve(),
  };
  return { server, handlers };
};

/** Mock RequestHandlerExtra for testing */
const mockExtra: RequestHandlerExtra = {
  signal: new AbortController().signal,
  sendNotification: () => Promise.resolve(),
};

/** Retrieve the tools/list handler by finding the handler that returns a { tools } shape */
const getListToolsHandler = (handlers: Map<unknown, RequestHandler>): RequestHandler => {
  // registerMcpHandlers registers exactly 2 handlers (tools/list and tools/call).
  // The tools/list handler is registered first. Iterate and return the one whose
  // result has a `tools` array property.
  for (const handler of handlers.values()) {
    const result = handler({ params: { name: '' } }, mockExtra) as Record<string, unknown>;
    if ('tools' in result) return handler;
  }
  throw new Error('tools/list handler not found');
};

describe('registerMcpHandlers — disabled tool filtering', () => {
  test('disabled tools are excluded from tools/list response', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages', 'list_channels'])], []);

    // Disable one tool via toolConfig
    state.toolConfig = { slack_read_messages: false };

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const listTools = getListToolsHandler(handlers);
    const result = listTools({ params: { name: '' } }, mockExtra) as { tools: Array<{ name: string }> };

    const toolNames = result.tools.map(t => t.name);
    expect(toolNames).toContain('slack_send_message');
    expect(toolNames).not.toContain('slack_read_messages');
    expect(toolNames).toContain('slack_list_channels');
    expect(toolNames).toHaveLength(2);
  });

  test('re-enabling a disabled tool makes it reappear in tools/list', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);

    // Disable a tool
    state.toolConfig = { slack_send_message: false };

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const listTools = getListToolsHandler(handlers);

    // Verify tool is absent when disabled
    const resultBefore = listTools({ params: { name: '' } }, mockExtra) as { tools: Array<{ name: string }> };
    const namesBefore = resultBefore.tools.map(t => t.name);
    expect(namesBefore).not.toContain('slack_send_message');
    expect(namesBefore).toContain('slack_read_messages');

    // Re-enable the tool
    state.toolConfig = {};

    // Same handler, same state reference — tool should reappear
    const resultAfter = listTools({ params: { name: '' } }, mockExtra) as { tools: Array<{ name: string }> };
    const namesAfter = resultAfter.tools.map(t => t.name);
    expect(namesAfter).toContain('slack_send_message');
    expect(namesAfter).toContain('slack_read_messages');
    expect(namesAfter).toHaveLength(2);
  });
});

/** Helper to create a browser tool definition for testing */
const createBrowserTool = (name: string, description: string): BrowserToolDefinition => ({
  name,
  description,
  input: z.object({}),
  handler: () => Promise.resolve([]),
});

describe('getEnabledToolsList — all tools enabled (default)', () => {
  test('returns all plugin tools and browser tools when no toolConfig is set', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('slack_send_message');
    expect(names).toContain('slack_read_messages');
    expect(names).toContain('browser_list_tabs');
    expect(tools).toHaveLength(3);
  });
});

describe('getEnabledToolsList — disabled tool filtering', () => {
  test('one plugin tool disabled via toolConfig is excluded, others remain', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.toolConfig = { slack_read_messages: false };

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('slack_send_message');
    expect(names).not.toContain('slack_read_messages');
    expect(names).toContain('browser_list_tabs');
    expect(tools).toHaveLength(2);
  });

  test('all plugin tools disabled — only browser tools appear', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.toolConfig = { slack_send_message: false, slack_read_messages: false };

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).not.toContain('slack_send_message');
    expect(names).not.toContain('slack_read_messages');
    expect(names).toContain('browser_list_tabs');
    expect(tools).toHaveLength(1);
  });

  test('browser tools always appear regardless of toolConfig entries matching their names', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    // Attempt to disable a browser tool via toolConfig — should have no effect
    state.toolConfig = { browser_list_tabs: false };

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('browser_list_tabs');
    expect(names).toContain('slack_send_message');
    expect(tools).toHaveLength(2);
  });

  test('multiple plugins with mixed enabled/disabled tools — correct filtering per plugin', () => {
    const state = createState();
    state.registry = buildRegistry(
      [createPlugin('slack', ['send_message', 'read_messages']), createPlugin('github', ['create_issue', 'list_prs'])],
      [],
    );
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.toolConfig = { slack_read_messages: false, github_create_issue: false };

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('slack_send_message');
    expect(names).not.toContain('slack_read_messages');
    expect(names).not.toContain('github_create_issue');
    expect(names).toContain('github_list_prs');
    expect(names).toContain('browser_list_tabs');
    expect(tools).toHaveLength(3);
  });

  test('empty plugins map returns only browser tools', () => {
    const state = createState();
    state.browserTools = [
      createBrowserTool('browser_list_tabs', 'List tabs'),
      createBrowserTool('browser_open_tab', 'Open a tab'),
    ];
    rebuildCachedBrowserTools(state);

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('browser_list_tabs');
    expect(names).toContain('browser_open_tab');
    expect(tools).toHaveLength(2);
  });
});

describe('getEnabledToolsList — browserToolPolicy filtering', () => {
  test('disabled browser tool is excluded from tools list', () => {
    const state = createState();
    state.browserTools = [
      createBrowserTool('browser_list_tabs', 'List tabs'),
      createBrowserTool('browser_execute_script', 'Execute script'),
    ];
    rebuildCachedBrowserTools(state);
    state.browserToolPolicy = { browser_execute_script: false };

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('browser_list_tabs');
    expect(names).not.toContain('browser_execute_script');
    expect(tools).toHaveLength(1);
  });

  test('all browser tools disabled — none appear in list', () => {
    const state = createState();
    state.browserTools = [
      createBrowserTool('browser_list_tabs', 'List tabs'),
      createBrowserTool('browser_open_tab', 'Open tab'),
    ];
    rebuildCachedBrowserTools(state);
    state.browserToolPolicy = { browser_list_tabs: false, browser_open_tab: false };

    const tools = getEnabledToolsList(state);
    expect(tools).toHaveLength(0);
  });

  test('empty browserToolPolicy means all browser tools enabled (default)', () => {
    const state = createState();
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.browserToolPolicy = {};

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('browser_list_tabs');
    expect(tools).toHaveLength(1);
  });

  test('re-enabling a disabled browser tool makes it reappear', () => {
    const state = createState();
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.browserToolPolicy = { browser_list_tabs: false };

    expect(getEnabledToolsList(state)).toHaveLength(0);

    state.browserToolPolicy = { browser_list_tabs: true };
    const tools = getEnabledToolsList(state);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('browser_list_tabs');
  });

  test('browserToolPolicy does not affect plugin tools', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.browserToolPolicy = { browser_list_tabs: false };

    const tools = getEnabledToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('slack_send_message');
    expect(names).not.toContain('browser_list_tabs');
    expect(tools).toHaveLength(1);
  });
});

describe('getEnabledToolsList — tool entry shape', () => {
  test('plugin tools have correct name, description with trust tier prefix, and inputSchema', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const tools = getEnabledToolsList(state);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'slack_send_message',
      description: '[Local plugin] send_message description',
      inputSchema: { type: 'object' },
    });
  });

  test('browser tools have correct name, description, and inputSchema', () => {
    const state = createState();
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List all open tabs')];
    rebuildCachedBrowserTools(state);

    const tools = getEnabledToolsList(state);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'browser_list_tabs',
      description: 'List all open tabs',
    });
    expect(typeof tools[0]?.inputSchema).toBe('object');
  });
});

describe('checkToolCallable', () => {
  test('returns ok with correct pluginName and toolName when tool exists and is enabled', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const result = checkToolCallable(state, 'slack_send_message');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pluginName).toBe('slack');
      expect(result.toolName).toBe('send_message');
    }
  });

  test('returns error containing "disabled" when tool exists but is disabled', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.toolConfig = { slack_send_message: false };

    const result = checkToolCallable(state, 'slack_send_message');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('disabled');
    }
  });

  test('returns error containing "not found" when tool does not exist', () => {
    const state = createState();

    const result = checkToolCallable(state, 'nonexistent_tool');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  test('browser tool names are not in toolLookup (handled separately)', () => {
    const state = createState();
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);

    const result = checkToolCallable(state, 'browser_list_tabs');

    // Browser tools are not in the plugin toolLookup — they are handled
    // by a separate code path before checkToolCallable is called
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });
});

describe('sanitizeOutput', () => {
  // Use JSON.parse to create objects with literal "__proto__" string keys —
  // object literals ({ __proto__: ... }) set the prototype chain rather than
  // creating an own property, so JSON.parse is the correct way to simulate
  // the attack vector (deserialized JSON with dangerous key names).
  test('strips __proto__, constructor, prototype from flat object', () => {
    const input = JSON.parse(
      '{"a":1,"__proto__":{"evil":true},"constructor":"bad","prototype":"also bad","b":2}',
    ) as Record<string, unknown>;
    const result = sanitizeOutput(input) as Record<string, unknown>;
    expect(result['a']).toBe(1);
    expect(result['b']).toBe(2);
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
    expect(Object.hasOwn(result, 'constructor')).toBe(false);
    expect(Object.hasOwn(result, 'prototype')).toBe(false);
  });

  test('strips dangerous keys from nested objects at multiple depths', () => {
    const input = JSON.parse(
      '{"safe":{"__proto__":{"evil":true},"nested":{"constructor":"bad","value":42}}}',
    ) as Record<string, unknown>;
    const result = sanitizeOutput(input) as Record<string, unknown>;
    const safe = result['safe'] as Record<string, unknown>;
    expect(Object.hasOwn(safe, '__proto__')).toBe(false);
    const nested = safe['nested'] as Record<string, unknown>;
    expect(Object.hasOwn(nested, 'constructor')).toBe(false);
    expect(nested['value']).toBe(42);
  });

  test('strips dangerous keys from objects inside arrays', () => {
    const input = JSON.parse(
      '[{"name":"alice","__proto__":{"evil":true}},{"name":"bob","constructor":"bad"}]',
    ) as Array<Record<string, unknown>>;
    const result = sanitizeOutput(input) as Array<Record<string, unknown>>;
    expect(result[0]?.['name']).toBe('alice');
    expect(Object.hasOwn(result[0] ?? {}, '__proto__')).toBe(false);
    expect(result[1]?.['name']).toBe('bob');
    expect(Object.hasOwn(result[1] ?? {}, 'constructor')).toBe(false);
  });

  test('handles mixed arrays of primitives and objects correctly', () => {
    const input = JSON.parse('[1,"hello",null,{"__proto__":"bad","x":10},true]') as unknown[];
    const result = sanitizeOutput(input) as unknown[];
    expect(result[0]).toBe(1);
    expect(result[1]).toBe('hello');
    expect(result[2]).toBe(null);
    const obj = result[3] as Record<string, unknown>;
    expect(obj['x']).toBe(10);
    expect(Object.hasOwn(obj, '__proto__')).toBe(false);
    expect(result[4]).toBe(true);
  });

  test('depth limit boundary — object at depth 51 is returned raw', () => {
    // Build an object nested exactly 51 levels deep:
    // sanitizeOutput is called on root at depth=0; it recurses into children at depth+1.
    // At depth 50, recursion still processes (depth <= 50 is false only at depth > 50).
    // At depth 51, the check `depth > 50` triggers and returns obj unchanged.
    let deep: unknown = { __proto__: 'should be stripped at depth 50', value: 'leaf' };
    for (let i = 0; i < 50; i++) {
      deep = { child: deep };
    }
    // Navigate 50 levels of "child" to reach the innermost object
    let result = sanitizeOutput(deep) as Record<string, unknown>;
    for (let i = 0; i < 50; i++) {
      result = result['child'] as Record<string, unknown>;
    }
    // At depth 50 we have an object; sanitizeOutput processes it (depth=50 is not > 50)
    // but the inner __proto__ key should be stripped since we're at depth=50 recursing to depth=51
    // At depth=51, depth > 50 triggers — but the key-stripping happens at depth=50 in the loop,
    // so the value is still sanitized. The raw return only affects the VALUE at depth > 50.
    expect(result['value']).toBe('leaf');
  });

  test('depth limit — returns safe placeholder at depth 51', () => {
    // Create an object so deep that the leaf exceeds the depth limit
    const leaf = { safe: 'yes' };
    let deep: unknown = leaf;
    // Push leaf to depth 51 where the depth limit kicks in
    for (let i = 0; i < 51; i++) {
      deep = { child: deep };
    }
    let result: unknown = sanitizeOutput(deep);
    for (let i = 0; i < 51; i++) {
      result = (result as Record<string, unknown>)['child'];
    }
    // At depth 51, depth > 50 returns a safe placeholder instead of the unsanitized object
    expect(result).toBe('[Object too deep]');
  });

  test('null passes through unchanged', () => {
    expect(sanitizeOutput(null)).toBe(null);
  });

  test('undefined passes through unchanged', () => {
    expect(sanitizeOutput(undefined)).toBe(undefined);
  });

  test('string primitive passes through unchanged', () => {
    expect(sanitizeOutput('hello')).toBe('hello');
  });

  test('number primitive passes through unchanged', () => {
    expect(sanitizeOutput(42)).toBe(42);
  });

  test('boolean primitive passes through unchanged', () => {
    expect(sanitizeOutput(true)).toBe(true);
    expect(sanitizeOutput(false)).toBe(false);
  });

  test('empty object returns empty object', () => {
    const result = sanitizeOutput({});
    expect(result).toEqual({});
  });

  test('partial-match keys are NOT stripped (__proto__x, constructorHelper)', () => {
    const input = JSON.parse('{"__proto__x":1,"myConstructor":2,"prototypeX":3,"safe":4}') as Record<string, unknown>;
    const result = sanitizeOutput(input) as Record<string, unknown>;
    expect(result['__proto__x']).toBe(1);
    expect(result['myConstructor']).toBe(2);
    expect(result['prototypeX']).toBe(3);
    expect(result['safe']).toBe(4);
  });
});

/** Create a plugin with resources and prompts for testing */
const createPluginWithResourcesPrompts = (name: string): RegisteredPlugin => ({
  ...createPlugin(name, ['ping']),
  resources: [{ uri: 'test://items', name: 'Items', description: 'Test items', mimeType: 'application/json' }],
  prompts: [{ name: 'greet', description: 'Greet someone', arguments: [{ name: 'name', required: true }] }],
});

/** Get a handler from the map or throw — avoids non-null assertions */
const getHandler = (handlers: Map<unknown, RequestHandler>, schema: unknown): RequestHandler => {
  const handler = handlers.get(schema);
  if (!handler) throw new Error(`Handler not registered for schema`);
  return handler;
};

describe('registerMcpHandlers — resources/list', () => {
  test('returns all resources from registered plugins with prefixed URIs', () => {
    const state = createState();
    state.registry = buildRegistry([createPluginWithResourcesPrompts('test-plug')], []);

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, ListResourcesRequestSchema);
    const result = handler({ params: { name: '' } }, mockExtra) as {
      resources: Array<{ uri: string; name: string }>;
    };

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.uri).toBe('opentabs+test-plug://test://items');
    expect(result.resources[0]?.name).toBe('Items');
  });

  test('returns empty array when no plugins have resources', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, ListResourcesRequestSchema);
    const result = handler({ params: { name: '' } }, mockExtra) as {
      resources: Array<{ uri: string }>;
    };

    expect(result.resources).toHaveLength(0);
  });
});

describe('registerMcpHandlers — prompts/list', () => {
  test('returns all prompts from registered plugins with prefixed names', () => {
    const state = createState();
    state.registry = buildRegistry([createPluginWithResourcesPrompts('test-plug')], []);

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, ListPromptsRequestSchema);
    const result = handler({ params: { name: '' } }, mockExtra) as {
      prompts: Array<{ name: string; description?: string }>;
    };

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]?.name).toBe('test-plug_greet');
    expect(result.prompts[0]?.description).toBe('Greet someone');
  });

  test('returns empty array when no plugins have prompts', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, ListPromptsRequestSchema);
    const result = handler({ params: { name: '' } }, mockExtra) as {
      prompts: Array<{ name: string }>;
    };

    expect(result.prompts).toHaveLength(0);
  });
});

describe('registerMcpHandlers — resources/read', () => {
  test('throws MCP error for unknown resource URI', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, ReadResourceRequestSchema);

    try {
      await handler({ params: { name: '', uri: 'nonexistent://resource' } }, mockExtra);
      throw new Error('Expected handler to throw');
    } catch (err) {
      expect((err as { message: string }).message).toContain('Resource not found');
    }
  });

  test('throws MCP error when extension is not connected', async () => {
    const state = createState();
    state.registry = buildRegistry([createPluginWithResourcesPrompts('test-plug')], []);

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, ReadResourceRequestSchema);

    try {
      await handler({ params: { name: '', uri: 'opentabs+test-plug://test://items' } }, mockExtra);
      throw new Error('Expected handler to throw');
    } catch (err) {
      expect((err as { message: string }).message).toContain('Extension not connected');
    }
  });
});

describe('registerMcpHandlers — prompts/get', () => {
  test('throws MCP error for unknown prompt name', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, GetPromptRequestSchema);

    try {
      await handler({ params: { name: 'nonexistent_prompt' } }, mockExtra);
      throw new Error('Expected handler to throw');
    } catch (err) {
      expect((err as { message: string }).message).toContain('Prompt not found');
    }
  });

  test('throws MCP error when extension is not connected', async () => {
    const state = createState();
    state.registry = buildRegistry([createPluginWithResourcesPrompts('test-plug')], []);

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, GetPromptRequestSchema);

    try {
      await handler({ params: { name: 'test-plug_greet', arguments: { name: 'World' } } }, mockExtra);
      throw new Error('Expected handler to throw');
    } catch (err) {
      expect((err as { message: string }).message).toContain('Extension not connected');
    }
  });
});

describe('registerMcpHandlers — generic dispatch error sanitization', () => {
  test('file paths in generic dispatch errors are sanitized to [PATH]', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('test', ['ping'])], []);

    // Fake WebSocket whose send() throws with a message containing a file path
    state.extensionWs = {
      send: () => {
        throw new Error('ENOENT: /home/user/.opentabs/plugins/test/dist/adapter.iife.js');
      },
      close: () => {},
    };

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, CallToolRequestSchema);
    const result = (await handler({ params: { name: 'test_ping', arguments: {} } }, mockExtra)) as {
      content: Array<{ text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('[PATH]');
    expect(text).not.toContain('/home/user/.opentabs');
  });
});
