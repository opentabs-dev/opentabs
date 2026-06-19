import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { BrowserToolDefinition } from './browser-tools/definition.js';
import { annotateTools, GATEWAY_TOOLS, handleCallTool, handleListTools } from './mcp-gateway.js';
import { PLATFORM_TOOL_NAMES, rebuildCachedBrowserTools } from './mcp-setup.js';
import type { DispatchCallbacks, RequestHandlerExtra, ToolCallResult } from './mcp-tool-dispatch.js';

/**
 * Test helper: assert the content part at `idx` is text-typed and return it
 * narrowed. handleCallTool returns a union content type since the dispatcher
 * may emit non-text parts; gateway-level tests still expect text for errors
 * and JSON tool output.
 */
const textPart = (result: ToolCallResult, idx = 0): { type: 'text'; text: string } => {
  const part = result.content[idx];
  if (!part || part.type !== 'text') {
    throw new Error(`Expected text content part at index ${idx}, got: ${JSON.stringify(part)}`);
  }
  return part;
};

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

/** Create a minimal RequestHandlerExtra for testing */
const createMockExtra = (): RequestHandlerExtra => ({
  signal: AbortSignal.timeout(5_000),
  sendNotification: () => Promise.resolve(),
});

/** No-op dispatch callbacks */
const createMockCallbacks = (): DispatchCallbacks => ({
  onToolConfigChanged: () => {},
});

describe('GATEWAY_TOOLS', () => {
  test('has exactly 2 tools', () => {
    expect(GATEWAY_TOOLS).toHaveLength(2);
  });

  test('tool names are opentabs_list_tools and opentabs_call', () => {
    const names = GATEWAY_TOOLS.map(t => t.name);
    expect(names).toContain('opentabs_list_tools');
    expect(names).toContain('opentabs_call');
  });

  test('each tool has name, description, and inputSchema', () => {
    for (const tool of GATEWAY_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe('object');
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('opentabs_call requires "tool" field', () => {
    const callTool = GATEWAY_TOOLS.find(t => t.name === 'opentabs_call');
    expect(callTool).toBeDefined();
    expect(callTool?.inputSchema.required).toEqual(['tool']);
  });

  test('opentabs_list_tools has optional plugin filter', () => {
    const listTool = GATEWAY_TOOLS.find(t => t.name === 'opentabs_list_tools');
    expect(listTool).toBeDefined();
    const properties = listTool?.inputSchema.properties as Record<string, unknown>;
    expect(properties.plugin).toBeDefined();
    expect(listTool?.inputSchema.required).toBeUndefined();
  });
});

describe('annotateTools', () => {
  test('annotates plugin tools with the plugin name', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);

    const result = annotateTools(state);

    const slackTool = result.find(t => t.name === 'slack_send_message');
    expect(slackTool).toBeDefined();
    expect(slackTool?.plugin).toBe('slack');
  });

  test('annotates browser tools with "browser"', () => {
    const state = createState();
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const result = annotateTools(state);

    const browserTool = result.find(t => t.name === 'browser_list_tabs');
    expect(browserTool).toBeDefined();
    expect(browserTool?.plugin).toBe('browser');
  });

  test('annotates platform tools with "platform"', () => {
    const state = createState();

    const result = annotateTools(state);

    const platformTool = result.find(t => PLATFORM_TOOL_NAMES.has(t.name));
    expect(platformTool).toBeDefined();
    expect(platformTool?.plugin).toBe('platform');
  });

  test('annotates tools from multiple plugins correctly', () => {
    const state = createState();
    state.registry = buildRegistry(
      [createPlugin('slack', ['send_message']), createPlugin('discord', ['read_messages'])],
      [],
    );
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const result = annotateTools(state);

    expect(result.find(t => t.name === 'slack_send_message')?.plugin).toBe('slack');
    expect(result.find(t => t.name === 'discord_read_messages')?.plugin).toBe('discord');
    expect(result.find(t => t.name === 'browser_list_tabs')?.plugin).toBe('browser');
  });

  test('each annotated tool has name, description, plugin, and inputSchema', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const result = annotateTools(state);

    for (const tool of result) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.plugin).toBe('string');
      expect(typeof tool.inputSchema).toBe('object');
    }
  });
});

describe('handleListTools', () => {
  test('returns all tools when no plugin filter is provided', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message', 'read_messages'])], []);
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const result = handleListTools(state, {});

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    const tools = JSON.parse(result.content[0]?.text ?? '[]') as Array<{ name: string; plugin: string }>;
    expect(tools.some(t => t.name === 'slack_send_message')).toBe(true);
    expect(tools.some(t => t.name === 'slack_read_messages')).toBe(true);
    expect(tools.some(t => t.name === 'browser_list_tabs')).toBe(true);
  });

  test('filters by plugin name', () => {
    const state = createState();
    state.registry = buildRegistry(
      [createPlugin('slack', ['send_message']), createPlugin('discord', ['read_messages'])],
      [],
    );

    const result = handleListTools(state, { plugin: 'slack' });

    const tools = JSON.parse(result.content[0]?.text ?? '[]') as Array<{ name: string; plugin: string }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('slack_send_message');
    expect(tools[0]?.plugin).toBe('slack');
  });

  test('filters to browser tools with plugin=browser', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const result = handleListTools(state, { plugin: 'browser' });

    const tools = JSON.parse(result.content[0]?.text ?? '[]') as Array<{ name: string; plugin: string }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('browser_list_tabs');
    expect(tools[0]?.plugin).toBe('browser');
  });

  test('returns empty array for nonexistent plugin filter', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const result = handleListTools(state, { plugin: 'nonexistent' });

    const tools = JSON.parse(result.content[0]?.text ?? '[]') as Array<{ name: string }>;
    expect(tools).toHaveLength(0);
  });

  test('each tool in result has name, description, plugin, and inputSchema', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const result = handleListTools(state, {});

    const tools = JSON.parse(result.content[0]?.text ?? '[]') as Array<Record<string, unknown>>;
    for (const tool of tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('plugin');
      expect(tool).toHaveProperty('inputSchema');
    }
  });

  test('ignores empty string plugin filter', () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const result = handleListTools(state, { plugin: '' });

    const tools = JSON.parse(result.content[0]?.text ?? '[]') as Array<{ name: string }>;
    // Empty string is treated as no filter — returns all tools
    expect(tools.length).toBeGreaterThan(1);
  });
});

describe('handleCallTool', () => {
  test('returns error when tool field is missing', async () => {
    const state = createState();

    const result = await handleCallTool(state, {}, createMockExtra(), createMockCallbacks());

    expect(result.isError).toBe(true);
    expect(textPart(result).text).toContain('"tool" must be a non-empty string');
  });

  test('returns error when tool field is empty string', async () => {
    const state = createState();

    const result = await handleCallTool(state, { tool: '' }, createMockExtra(), createMockCallbacks());

    expect(result.isError).toBe(true);
    expect(textPart(result).text).toContain('"tool" must be a non-empty string');
  });

  test('returns error when tool field is not a string', async () => {
    const state = createState();

    const result = await handleCallTool(state, { tool: 123 }, createMockExtra(), createMockCallbacks());

    expect(result.isError).toBe(true);
    expect(textPart(result).text).toContain('"tool" must be a non-empty string');
  });

  test('returns error for unknown tool name', async () => {
    const state = createState();

    const result = await handleCallTool(state, { tool: 'nonexistent_tool' }, createMockExtra(), createMockCallbacks());

    expect(result.isError).toBe(true);
    expect(textPart(result).text).toContain('not found');
  });

  test('routes browser tool call to browser dispatch', async () => {
    const state = createState();
    const browserTool: BrowserToolDefinition = {
      name: 'browser_test_tool',
      description: 'Test tool',
      input: z.object({ query: z.string().optional() }),
      handler: async () => [{ type: 'text' as const, text: JSON.stringify({ result: 'browser-ok' }) }],
    };
    state.browserTools = [browserTool];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { permission: 'auto' } };

    const result = await handleCallTool(
      state,
      { tool: 'browser_test_tool', arguments: {} },
      createMockExtra(),
      createMockCallbacks(),
    );

    expect(result.isError).toBeUndefined();
    expect(textPart(result).text).toContain('browser-ok');
  });

  test('routes plugin tool call and returns "Extension not connected" without extension', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);
    state.pluginPermissions = { slack: { permission: 'auto', reviewedVersion: '1.0.0' } };

    const result = await handleCallTool(
      state,
      { tool: 'slack_send_message', arguments: { channel: 'C123', text: 'hello' } },
      createMockExtra(),
      createMockCallbacks(),
    );

    expect(result.isError).toBe(true);
    expect(textPart(result).text).toContain('Extension not connected');
  });

  test('passes arguments through to the dispatch handler', async () => {
    const state = createState();
    let receivedArgs: Record<string, unknown> = {};
    const browserTool: BrowserToolDefinition = {
      name: 'browser_echo_tool',
      description: 'Echo args',
      input: z.object({ msg: z.string().optional() }),
      handler: async args => {
        receivedArgs = args as Record<string, unknown>;
        return [{ type: 'text' as const, text: 'ok' }];
      },
    };
    state.browserTools = [browserTool];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { permission: 'auto' } };

    await handleCallTool(
      state,
      { tool: 'browser_echo_tool', arguments: { msg: 'hello' } },
      createMockExtra(),
      createMockCallbacks(),
    );

    expect(receivedArgs.msg).toBe('hello');
  });

  test('uses empty object when arguments field is missing', async () => {
    const state = createState();
    let receivedArgs: Record<string, unknown> = {};
    const browserTool: BrowserToolDefinition = {
      name: 'browser_noargs_tool',
      description: 'No args tool',
      input: z.object({}),
      handler: async args => {
        receivedArgs = args as Record<string, unknown>;
        return [{ type: 'text' as const, text: 'ok' }];
      },
    };
    state.browserTools = [browserTool];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { permission: 'auto' } };

    await handleCallTool(state, { tool: 'browser_noargs_tool' }, createMockExtra(), createMockCallbacks());

    expect(receivedArgs).toEqual({});
  });

  test('uses empty object when arguments is an array', async () => {
    const state = createState();
    let receivedArgs: Record<string, unknown> = {};
    const browserTool: BrowserToolDefinition = {
      name: 'browser_arrayargs_tool',
      description: 'Array args tool',
      input: z.object({}),
      handler: async args => {
        receivedArgs = args as Record<string, unknown>;
        return [{ type: 'text' as const, text: 'ok' }];
      },
    };
    state.browserTools = [browserTool];
    rebuildCachedBrowserTools(state);
    state.pluginPermissions = { browser: { permission: 'auto' } };

    await handleCallTool(
      state,
      { tool: 'browser_arrayargs_tool', arguments: [1, 2, 3] },
      createMockExtra(),
      createMockCallbacks(),
    );

    expect(receivedArgs).toEqual({});
  });

  test('routes plugin_inspect to platform handler', async () => {
    const state = createState();
    state.registry = buildRegistry([createPlugin('slack', ['send_message'])], []);

    const result = await handleCallTool(
      state,
      { tool: 'plugin_inspect', arguments: { plugin: 'slack' } },
      createMockExtra(),
      createMockCallbacks(),
    );

    // plugin_inspect requires adapter file on disk — returns error for test plugin without real file
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });
});
