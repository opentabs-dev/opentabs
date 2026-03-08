import { CallToolRequestSchema, ListResourceTemplatesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { BrowserToolDefinition } from './browser-tools/definition.js';
import { buildConfigStatePayload } from './extension-handlers.js';
import type { McpServerInstance, RequestHandlerExtra } from './mcp-setup.js';
import {
  checkToolCallable,
  getAllToolsList,
  PLATFORM_TOOL_NAMES,
  rebuildCachedBrowserTools,
  registerMcpHandlers,
  sanitizeOutput,
} from './mcp-setup.js';
import { buildRegistry } from './registry.js';
import type { RegisteredPlugin } from './state.js';
import { createState } from './state.js';

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
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
  })),
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
  for (const handler of handlers.values()) {
    const result = handler({ params: { name: '' } }, mockExtra) as Record<string, unknown>;
    if ('tools' in result) return handler;
  }
  throw new Error('tools/list handler not found');
};

/** Helper to create a browser tool definition for testing */
const createBrowserTool = (name: string, description: string): BrowserToolDefinition => ({
  name,
  description,
  input: z.object({}),
  handler: () => Promise.resolve([]),
});

describe('registerMcpHandlers — tools/list includes all tools regardless of permission', () => {
  test('all tools are listed even when some have permission off', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages', 'list_channels'])], []);

    // Plugin enabled with one tool off
    state.pluginPermissions = { slack: { permission: 'auto', tools: { read_messages: 'off' } } };

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const listTools = getListToolsHandler(handlers);
    const result = listTools({ params: { name: '' } }, mockExtra) as { tools: Array<{ name: string }> };

    const toolNames = result.tools.map(t => t.name);
    expect(toolNames).toContain('slack_send_message');
    expect(toolNames).toContain('slack_read_messages');
    expect(toolNames).toContain('slack_list_channels');
    expect(toolNames).toHaveLength(3 + PLATFORM_TOOL_NAMES.size);
  });

  test('tools/list reflects permission changes dynamically', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);

    state.pluginPermissions = { slack: { permission: 'auto', tools: { send_message: 'off' } } };

    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const listTools = getListToolsHandler(handlers);

    // Tool has [Disabled] prefix when off
    const resultBefore = listTools({ params: { name: '' } }, mockExtra) as {
      tools: Array<{ name: string; description: string }>;
    };
    const sendBefore = resultBefore.tools.find(t => t.name === 'slack_send_message');
    expect(sendBefore?.description).toMatch(/^\[Disabled\] /);

    // Change permission to auto — prefix goes away
    state.pluginPermissions = { slack: { permission: 'auto' } };

    const resultAfter = listTools({ params: { name: '' } }, mockExtra) as {
      tools: Array<{ name: string; description: string }>;
    };
    const sendAfter = resultAfter.tools.find(t => t.name === 'slack_send_message');
    expect(sendAfter?.description).not.toMatch(/^\[Disabled\]/);
    expect(sendAfter?.description).toBe('send_message description');
  });
});

describe('getAllToolsList — all tools always listed', () => {
  test('returns all plugin tools and browser tools regardless of permission', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    // No permissions set — all default to 'off', but still listed
    state.pluginPermissions = {};

    const tools = getAllToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('slack_send_message');
    expect(names).toContain('slack_read_messages');
    expect(names).toContain('browser_list_tabs');
    expect(tools).toHaveLength(3 + PLATFORM_TOOL_NAMES.size);
  });

  test('tools with permission off are listed with [Disabled] prefix', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    // No permission config — defaults to 'off'

    const tools = getAllToolsList(state);
    const pluginTools = tools.filter(t => !PLATFORM_TOOL_NAMES.has(t.name));

    expect(pluginTools).toHaveLength(1);
    expect(pluginTools[0]?.description).toBe('[Disabled] send_message description');
  });

  test('tools with permission ask are listed with [Requires approval] prefix', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { permission: 'ask' } };

    const tools = getAllToolsList(state);
    const pluginTools = tools.filter(t => !PLATFORM_TOOL_NAMES.has(t.name));

    expect(pluginTools).toHaveLength(1);
    expect(pluginTools[0]?.description).toBe('[Requires approval] send_message description');
  });

  test('tools with permission auto have no description prefix', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { permission: 'auto' } };

    const tools = getAllToolsList(state);
    const pluginTools = tools.filter(t => !PLATFORM_TOOL_NAMES.has(t.name));

    expect(pluginTools).toHaveLength(1);
    expect(pluginTools[0]?.description).toBe('send_message description');
  });

  test('browser tools get description prefixes based on their permission', () => {
    const state = createState();
    state.browserTools = [
      createBrowserTool('browser_list_tabs', 'List tabs'),
      createBrowserTool('browser_screenshot', 'Take screenshot'),
    ];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = {
      browser: { permission: 'ask', tools: { browser_screenshot: 'auto' } },
    };

    const tools = getAllToolsList(state);
    const listTabs = tools.find(t => t.name === 'browser_list_tabs');
    const screenshot = tools.find(t => t.name === 'browser_screenshot');

    expect(listTabs?.description).toBe('[Requires approval] List tabs');
    expect(screenshot?.description).toBe('Take screenshot');
  });

  test('all browser tools off still appear with [Disabled] prefix', () => {
    const state = createState();
    state.browserTools = [
      createBrowserTool('browser_list_tabs', 'List tabs'),
      createBrowserTool('browser_open_tab', 'Open tab'),
    ];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { permission: 'off' } };

    const tools = getAllToolsList(state);
    const browserTools = tools.filter(t => t.name.startsWith('browser_'));
    expect(browserTools).toHaveLength(2);
    for (const tool of browserTools) {
      expect(tool.description).toMatch(/^\[Disabled\] /);
    }
  });

  test('multiple plugins with mixed permissions show correct prefixes', () => {
    const state = createState();
    state.registry = buildRegistry(
      [createPlugin('slack', ['send_message', 'read_messages']), createPlugin('github', ['create_issue', 'list_prs'])],
      [],
    );
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = {
      slack: { permission: 'auto', tools: { read_messages: 'ask' } },
      github: { permission: 'off', tools: { list_prs: 'auto' } },
      browser: { permission: 'auto' },
    };

    const tools = getAllToolsList(state);
    const byName = Object.fromEntries(tools.map(t => [t.name, t.description]));

    expect(byName.slack_send_message).toBe('send_message description');
    expect(byName.slack_read_messages).toBe('[Requires approval] read_messages description');
    expect(byName.github_create_issue).toBe('[Disabled] create_issue description');
    expect(byName.github_list_prs).toBe('list_prs description');
    expect(byName.browser_list_tabs).toBe('List tabs');
    expect(tools).toHaveLength(5 + PLATFORM_TOOL_NAMES.size);
  });

  test('skipPermissions=true with off permissions still shows [Disabled] prefix', () => {
    const state = createState();
    state.skipPermissions = true;
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { slack: { permission: 'off' }, browser: { permission: 'off' } };

    const tools = getAllToolsList(state);

    expect(tools).toHaveLength(2 + PLATFORM_TOOL_NAMES.size);
    const nonPlatformTools = tools.filter(t => !PLATFORM_TOOL_NAMES.has(t.name));
    for (const tool of nonPlatformTools) {
      expect(tool.description).toMatch(/^\[Disabled\]/);
    }
  });

  test('skipPermissions=true with ask permissions shows no prefixes (auto)', () => {
    const state = createState();
    state.skipPermissions = true;
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { slack: { permission: 'ask' }, browser: { permission: 'ask' } };

    const tools = getAllToolsList(state);

    // 2 normal tools + platform tools (platform tools have no prefix)
    expect(tools).toHaveLength(2 + PLATFORM_TOOL_NAMES.size);
    const nonPlatformTools = tools.filter(t => !PLATFORM_TOOL_NAMES.has(t.name));
    for (const tool of nonPlatformTools) {
      expect(tool.description).not.toMatch(/^\[/);
    }
  });

  test('empty plugins map returns only browser tools and platform tools', () => {
    const state = createState();
    state.browserTools = [
      createBrowserTool('browser_list_tabs', 'List tabs'),
      createBrowserTool('browser_open_tab', 'Open a tab'),
    ];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { permission: 'auto' } };

    const tools = getAllToolsList(state);
    const names = tools.map(t => t.name);

    expect(names).toContain('browser_list_tabs');
    expect(names).toContain('browser_open_tab');
    expect(tools).toHaveLength(2 + PLATFORM_TOOL_NAMES.size);
  });
});

describe('getAllToolsList — tool entry shape', () => {
  test('plugin tools have correct name, description, and inputSchema', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { permission: 'auto' } };

    const tools = getAllToolsList(state);
    const pluginTools = tools.filter(t => !PLATFORM_TOOL_NAMES.has(t.name));

    expect(pluginTools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'slack_send_message',
      description: 'send_message description',
      inputSchema: { type: 'object' },
    });
  });

  test('browser tools have correct name, description, and inputSchema', () => {
    const state = createState();
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List all open tabs')];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { permission: 'auto' } };

    const tools = getAllToolsList(state);
    const browserTools = tools.filter(t => t.name.startsWith('browser_'));

    expect(browserTools).toHaveLength(1);
    const listTabsTool = tools.find(t => t.name === 'browser_list_tabs');
    expect(listTabsTool).toMatchObject({
      name: 'browser_list_tabs',
      description: 'List all open tabs',
    });
    expect(typeof listTabsTool?.inputSchema).toBe('object');
  });
});

describe('getAllToolsList — tabId schema injection', () => {
  test('plugin tools have tabId injected into inputSchema properties', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { permission: 'auto' } };

    const tools = getAllToolsList(state);
    const slackTool = tools.find(t => t.name === 'slack_send_message');

    expect(slackTool).toBeDefined();
    const schema = slackTool?.inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.tabId).toBeDefined();
    const tabIdDef = properties.tabId as { type: string; description: string };
    expect(tabIdDef.type).toBe('integer');
    expect(tabIdDef.description).toContain('Target a specific browser tab');
  });

  test('tabId description mentions browser_list_tabs and plugin_list_tabs', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { permission: 'auto' } };

    const tools = getAllToolsList(state);

    const schema = tools[0]?.inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    const tabIdDef = properties.tabId as { description: string };
    expect(tabIdDef.description).toContain('browser_list_tabs');
    expect(tabIdDef.description).toContain('plugin_list_tabs');
  });

  test('tabId injection does not mutate the original ManifestTool input_schema', () => {
    const state = createState();
    const plugin = createPlugin('slack', ['send_message']);
    state.registry = buildRegistry([plugin], []);
    state.pluginPermissions = { slack: { permission: 'auto' } };

    // Capture the original schema BEFORE calling getAllToolsList
    const originalTool = plugin.tools[0];
    if (!originalTool) throw new Error('Expected at least one tool');
    const originalSchema = originalTool.input_schema;
    const originalProperties = originalSchema.properties as Record<string, unknown> | undefined;

    // Call getAllToolsList which injects tabId into a clone
    getAllToolsList(state);

    // Original schema must NOT have tabId
    if (originalProperties) {
      expect(originalProperties.tabId).toBeUndefined();
    }
    // Verify the original schema object is unmodified
    expect(originalSchema).toEqual({ type: 'object' });
  });

  test('tabId is NOT added to required array', () => {
    const state = createState();
    const plugin: RegisteredPlugin = {
      ...createPlugin('slack', ['send_message']),
      tools: [
        {
          name: 'send_message',
          displayName: 'Send Message',
          description: 'Send a message',
          icon: 'wrench',
          input_schema: {
            type: 'object',
            properties: { channel: { type: 'string' } },
            required: ['channel'],
          },
          output_schema: { type: 'object' },
        },
      ],
    };
    state.registry = buildRegistry([plugin], []);
    state.pluginPermissions = { slack: { permission: 'auto' } };

    const tools = getAllToolsList(state);

    const schema = tools[0]?.inputSchema as Record<string, unknown>;
    const required = schema.required as string[] | undefined;
    // tabId should NOT be in the required array
    expect(required).not.toContain('tabId');
    // Original required fields are preserved
    expect(required).toContain('channel');
  });

  test('browser tools do NOT have tabId injected', () => {
    const state = createState();
    state.browserTools = [createBrowserTool('browser_list_tabs', 'List tabs')];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { permission: 'auto' } };

    const tools = getAllToolsList(state);
    const browserTool = tools.find(t => t.name === 'browser_list_tabs');

    expect(browserTool).toBeDefined();
    const schema = browserTool?.inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown> | undefined;
    if (properties) {
      expect(properties.tabId).toBeUndefined();
    }
  });

  test('multiple plugin tools each get independent tabId injection', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);
    state.pluginPermissions = { slack: { permission: 'auto' } };

    const tools = getAllToolsList(state);
    const pluginTools = tools.filter(t => t.name.startsWith('slack_'));

    expect(pluginTools).toHaveLength(2);
    for (const tool of pluginTools) {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties.tabId).toBeDefined();
      const tabIdDef = properties.tabId as { type: string; description: string };
      expect(tabIdDef.type).toBe('integer');
      expect(tabIdDef.description).toContain('Target a specific browser tab');
    }
  });
});

describe('checkToolCallable', () => {
  test('returns ok with correct pluginName and toolName when tool exists', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const result = checkToolCallable(state, 'slack_send_message');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pluginName).toBe('slack');
      expect(result.toolName).toBe('send_message');
    }
  });

  test('returns ok even when tool permission is off (permission checks at dispatch time)', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    // Default permission is 'off' — but checkToolCallable no longer checks this

    const result = checkToolCallable(state, 'slack_send_message');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pluginName).toBe('slack');
      expect(result.toolName).toBe('send_message');
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
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
    expect(Object.hasOwn(result, 'constructor')).toBe(false);
    expect(Object.hasOwn(result, 'prototype')).toBe(false);
  });

  test('strips dangerous keys from nested objects at multiple depths', () => {
    const input = JSON.parse(
      '{"safe":{"__proto__":{"evil":true},"nested":{"constructor":"bad","value":42}}}',
    ) as Record<string, unknown>;
    const result = sanitizeOutput(input) as Record<string, unknown>;
    const safe = result.safe as Record<string, unknown>;
    expect(Object.hasOwn(safe, '__proto__')).toBe(false);
    const nested = safe.nested as Record<string, unknown>;
    expect(Object.hasOwn(nested, 'constructor')).toBe(false);
    expect(nested.value).toBe(42);
  });

  test('strips dangerous keys from objects inside arrays', () => {
    const input = JSON.parse(
      '[{"name":"alice","__proto__":{"evil":true}},{"name":"bob","constructor":"bad"}]',
    ) as Array<Record<string, unknown>>;
    const result = sanitizeOutput(input) as Array<Record<string, unknown>>;
    expect(result[0]?.name).toBe('alice');
    expect(Object.hasOwn(result[0] ?? {}, '__proto__')).toBe(false);
    expect(result[1]?.name).toBe('bob');
    expect(Object.hasOwn(result[1] ?? {}, 'constructor')).toBe(false);
  });

  test('handles mixed arrays of primitives and objects correctly', () => {
    const input = JSON.parse('[1,"hello",null,{"__proto__":"bad","x":10},true]') as unknown[];
    const result = sanitizeOutput(input) as unknown[];
    expect(result[0]).toBe(1);
    expect(result[1]).toBe('hello');
    expect(result[2]).toBe(null);
    const obj = result[3] as Record<string, unknown>;
    expect(obj.x).toBe(10);
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
      result = result.child as Record<string, unknown>;
    }
    // At depth 50 we have an object; sanitizeOutput processes it (depth=50 is not > 50)
    // but the inner __proto__ key should be stripped since we're at depth=50 recursing to depth=51
    // At depth=51, depth > 50 triggers — but the key-stripping happens at depth=50 in the loop,
    // so the value is still sanitized. The raw return only affects the VALUE at depth > 50.
    expect(result.value).toBe('leaf');
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
      result = (result as Record<string, unknown>).child;
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
    expect(result.__proto__x).toBe(1);
    expect(result.myConstructor).toBe(2);
    expect(result.prototypeX).toBe(3);
    expect(result.safe).toBe(4);
  });
});

/** Get a handler from the map or throw — avoids non-null assertions */
const getHandler = (handlers: Map<unknown, RequestHandler>, schema: unknown): RequestHandler => {
  const handler = handlers.get(schema);
  if (!handler) throw new Error(`Handler not registered for schema`);
  return handler;
};

describe('getAllToolsList — platform tools', () => {
  test('plugin_inspect is included in tools list', () => {
    const state = createState();

    const tools = getAllToolsList(state);
    const inspectTool = tools.find(t => t.name === 'plugin_inspect');

    expect(inspectTool).toBeDefined();
    expect(inspectTool?.description).toContain('security review');
    expect(inspectTool?.inputSchema).toHaveProperty('properties');
  });

  test('plugin_inspect has no permission prefix', () => {
    const state = createState();
    // Even with no permissions set, platform tools should have no prefix
    state.pluginPermissions = {};

    const tools = getAllToolsList(state);
    const inspectTool = tools.find(t => t.name === 'plugin_inspect');

    expect(inspectTool?.description).not.toMatch(/^\[/);
  });

  test('plugin_inspect does not have tabId injected', () => {
    const state = createState();

    const tools = getAllToolsList(state);
    const inspectTool = tools.find(t => t.name === 'plugin_inspect');

    const properties = inspectTool?.inputSchema.properties as Record<string, unknown> | undefined;
    expect(properties?.tabId).toBeUndefined();
  });

  test('PLATFORM_TOOL_NAMES contains plugin_inspect', () => {
    expect(PLATFORM_TOOL_NAMES.has('plugin_inspect')).toBe(true);
  });

  test('plugin_mark_reviewed is included in tools list', () => {
    const state = createState();

    const tools = getAllToolsList(state);
    const reviewTool = tools.find(t => t.name === 'plugin_mark_reviewed');

    expect(reviewTool).toBeDefined();
    expect(reviewTool?.description).toContain('reviewed');
    expect(reviewTool?.inputSchema).toHaveProperty('properties');
  });

  test('plugin_mark_reviewed has no permission prefix', () => {
    const state = createState();
    state.pluginPermissions = {};

    const tools = getAllToolsList(state);
    const reviewTool = tools.find(t => t.name === 'plugin_mark_reviewed');

    expect(reviewTool?.description).not.toMatch(/^\[/);
  });

  test('plugin_mark_reviewed does not have tabId injected', () => {
    const state = createState();

    const tools = getAllToolsList(state);
    const reviewTool = tools.find(t => t.name === 'plugin_mark_reviewed');

    const properties = reviewTool?.inputSchema.properties as Record<string, unknown> | undefined;
    expect(properties?.tabId).toBeUndefined();
  });

  test('PLATFORM_TOOL_NAMES contains plugin_mark_reviewed', () => {
    expect(PLATFORM_TOOL_NAMES.has('plugin_mark_reviewed')).toBe(true);
  });

  test('platform tools are not included in buildConfigStatePayload', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('test', ['ping'])], []);

    const payload = buildConfigStatePayload(state);

    const allToolNames = [
      ...payload.browserTools.map(t => t.name),
      ...payload.plugins.flatMap(p => p.tools.map(t => t.name)),
    ];
    expect(allToolNames).not.toContain('plugin_inspect');
    expect(allToolNames).not.toContain('plugin_mark_reviewed');
  });

  test('buildConfigStatePayload returns configured permissions, not effective (ignores skipPermissions)', () => {
    const state = createState();
    state.skipPermissions = true;
    state.registry = buildRegistry([createPlugin('test', ['ping', 'pong'])], []);
    state.pluginPermissions = {
      test: { permission: 'ask', tools: { pong: 'off' } },
    };
    rebuildCachedBrowserTools(state);

    const payload = buildConfigStatePayload(state);

    // Plugin tools: ping inherits plugin default 'ask', pong has per-tool 'off'
    const testPlugin = payload.plugins.find(p => p.name === 'test');
    expect(testPlugin).toBeDefined();
    const ping = testPlugin?.tools.find(t => t.name === 'ping');
    const pong = testPlugin?.tools.find(t => t.name === 'pong');
    // With skipPermissions, getToolPermission would return 'auto' for 'ask' — but
    // buildConfigStatePayload should return the configured value 'ask'
    expect(ping?.permission).toBe('ask');
    expect(pong?.permission).toBe('off');
  });

  test('buildConfigStatePayload returns configured browser tool permissions (ignores skipPermissions)', () => {
    const state = createState();
    state.skipPermissions = true;
    state.pluginPermissions = { browser: { permission: 'ask' } };
    state.browserTools = [
      {
        name: 'browser_test',
        description: 'Test browser tool',
        input: z.object({}),
        handler: async () => ({ content: [] }),
      },
    ];
    rebuildCachedBrowserTools(state);

    const payload = buildConfigStatePayload(state);

    const bt = payload.browserTools.find(t => t.name === 'browser_test');
    expect(bt).toBeDefined();
    // With skipPermissions, getToolPermission returns 'auto' for 'ask' — but
    // buildConfigStatePayload should return the configured 'ask'
    expect(bt?.permission).toBe('ask');

    // browserPermission should also reflect configured value
    expect(payload.browserPermission).toBe('ask');
  });
});

describe('registerMcpHandlers — handler count', () => {
  test('registers exactly 5 handlers: tools/list, tools/call, resources/list, resources/templates/list, resources/read', () => {
    const state = createState();
    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    expect(handlers.size).toBe(5);
  });
});

describe('registerMcpHandlers — resources/templates/list handler', () => {
  test('returns an empty resourceTemplates array', () => {
    const state = createState();
    const { server, handlers } = createMockServer();
    registerMcpHandlers(server, state);

    const handler = getHandler(handlers, ListResourceTemplatesRequestSchema);
    const result = handler({ params: { name: '' } }, mockExtra) as {
      resourceTemplates: unknown[];
    };

    expect(result.resourceTemplates).toEqual([]);
  });
});

describe('registerMcpHandlers — generic dispatch error sanitization', () => {
  test('file paths in generic dispatch errors are sanitized to [PATH]', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('test', ['ping'])], []);
    state.pluginPermissions = { test: { permission: 'auto' } };

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
