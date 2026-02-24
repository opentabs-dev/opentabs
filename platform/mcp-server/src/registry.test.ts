import {
  buildRegistry,
  emptyRegistry,
  getPlugin,
  getPrompt,
  getResource,
  getTool,
  listAllPrompts,
  listAllResources,
} from './registry.js';
import { describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import type { FailedPlugin, RegisteredPlugin } from './state.js';

/**
 * Unit tests for the immutable PluginRegistry module.
 *
 * Tests cover registry construction, tool lookup, plugin retrieval,
 * immutability guarantees, and tool filtering by config.
 */

/** Create a minimal RegisteredPlugin for testing */
const makePlugin = (overrides: Partial<RegisteredPlugin> = {}): RegisteredPlugin => ({
  name: 'test',
  version: '1.0.0',
  displayName: 'Test Plugin',
  urlPatterns: ['http://localhost/*'],
  trustTier: 'local',
  source: 'local' as const,
  iife: '(function(){})()',
  tools: [
    {
      name: 'my_tool',
      displayName: 'My Tool',
      description: 'A tool',
      icon: 'wrench',
      input_schema: { type: 'object', properties: { msg: { type: 'string' } } },
      output_schema: {},
    },
  ],
  resources: [],
  prompts: [],
  sourcePath: path.join(os.tmpdir(), 'test-plugin'),
  adapterHash: 'abc123',
  npmPackageName: 'opentabs-plugin-test',
  ...overrides,
});

describe('buildRegistry', () => {
  test('builds a registry from loaded plugins', () => {
    const plugin = makePlugin();
    const registry = buildRegistry([plugin], []);

    expect(registry.plugins.size).toBe(1);
    expect(registry.plugins.get('test')).toBe(plugin);
    expect(registry.toolLookup.size).toBe(1);
    expect(registry.failures).toHaveLength(0);
  });

  test('builds tool lookup with prefixed names', () => {
    const plugin = makePlugin();
    const registry = buildRegistry([plugin], []);

    const lookup = registry.toolLookup.get('test_my_tool');
    expect(lookup).toBeDefined();
    expect(lookup?.pluginName).toBe('test');
    expect(lookup?.toolName).toBe('my_tool');
  });

  test('compiles Ajv validators for tool input schemas', () => {
    const plugin = makePlugin();
    const registry = buildRegistry([plugin], []);

    const lookup = registry.toolLookup.get('test_my_tool');
    expect(lookup?.validate).toBeTypeOf('function');
    // Valid input should pass
    expect(lookup?.validate?.({ msg: 'hello' })).toBe(true);
  });

  test('handles multiple plugins without name collisions', () => {
    const pluginA = makePlugin({
      name: 'alpha',
      tools: [
        {
          name: 'do_thing',
          displayName: 'Do Thing',
          description: 'Does a thing',
          icon: 'star',
          input_schema: {},
          output_schema: {},
        },
      ],
    });
    const pluginB = makePlugin({
      name: 'beta',
      tools: [
        {
          name: 'do_thing',
          displayName: 'Do Thing',
          description: 'Does a thing',
          icon: 'star',
          input_schema: {},
          output_schema: {},
        },
      ],
    });
    const registry = buildRegistry([pluginA, pluginB], []);

    expect(registry.plugins.size).toBe(2);
    expect(registry.toolLookup.size).toBe(2);
    expect(registry.toolLookup.has('alpha_do_thing')).toBe(true);
    expect(registry.toolLookup.has('beta_do_thing')).toBe(true);
  });

  test('preserves failures in the registry', () => {
    const failures: FailedPlugin[] = [
      { path: '/bad/plugin', error: 'Missing package.json' },
      { path: '/other/plugin', error: 'Invalid opentabs field' },
    ];
    const registry = buildRegistry([], failures);

    expect(registry.failures).toHaveLength(2);
    expect(registry.failures[0]?.path).toBe('/bad/plugin');
    expect(registry.failures[1]?.error).toBe('Invalid opentabs field');
  });

  test('returns frozen registry object', () => {
    const registry = buildRegistry([makePlugin()], []);

    expect(Object.isFrozen(registry)).toBe(true);
  });

  test('replaces previous tool lookup entries on rebuild', () => {
    const registryV1 = buildRegistry([makePlugin({ name: 'slack' })], []);
    expect(registryV1.toolLookup.size).toBe(1);
    expect(registryV1.toolLookup.has('slack_my_tool')).toBe(true);

    const registryV2 = buildRegistry(
      [
        makePlugin({
          name: 'github',
          tools: [
            {
              name: 'create_issue',
              displayName: 'Create Issue',
              description: 'Creates an issue',
              icon: 'star',
              input_schema: { type: 'object' },
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    expect(registryV2.toolLookup.size).toBe(1);
    expect(registryV2.toolLookup.has('slack_my_tool')).toBe(false);
    expect(registryV2.toolLookup.get('github_create_issue')).toMatchObject({
      pluginName: 'github',
      toolName: 'create_issue',
    });
  });

  test('handles tool with invalid schema gracefully (validate is null)', () => {
    const plugin = makePlugin({
      tools: [
        {
          name: 'bad_schema',
          displayName: 'Bad',
          description: 'Bad schema',
          icon: 'x',
          input_schema: { type: 'invalid-type-value' } as Record<string, unknown>,
          output_schema: {},
        },
      ],
    });
    const registry = buildRegistry([plugin], []);

    const lookup = registry.toolLookup.get('test_bad_schema');
    expect(lookup).toBeDefined();
    expect(lookup?.validate).toBeNull();
    expect(lookup?.validationErrors()).toContain('Schema compilation failed');
  });
});

describe('emptyRegistry', () => {
  test('returns a registry with no plugins, tools, or failures', () => {
    const registry = emptyRegistry();

    expect(registry.plugins.size).toBe(0);
    expect(registry.toolLookup.size).toBe(0);
    expect(registry.failures).toHaveLength(0);
  });

  test('returns a frozen registry', () => {
    const registry = emptyRegistry();
    expect(Object.isFrozen(registry)).toBe(true);
  });
});

describe('getPlugin', () => {
  test('returns plugin by internal name', () => {
    const plugin = makePlugin({ name: 'slack' });
    const registry = buildRegistry([plugin], []);

    expect(getPlugin(registry, 'slack')).toBe(plugin);
  });

  test('returns undefined for unknown plugin name', () => {
    const registry = buildRegistry([makePlugin()], []);

    expect(getPlugin(registry, 'nonexistent')).toBeUndefined();
  });
});

describe('getTool', () => {
  test('returns plugin, tool, and lookup for a valid prefixed name', () => {
    const plugin = makePlugin();
    const registry = buildRegistry([plugin], []);

    const result = getTool(registry, 'test_my_tool');
    expect(result).toBeDefined();
    expect(result?.plugin).toBe(plugin);
    expect(result?.tool.name).toBe('my_tool');
    expect(result?.lookup.pluginName).toBe('test');
    expect(result?.lookup.toolName).toBe('my_tool');
  });

  test('returns undefined for unknown tool name', () => {
    const registry = buildRegistry([makePlugin()], []);

    expect(getTool(registry, 'test_nonexistent')).toBeUndefined();
  });

  test('returns undefined for empty registry', () => {
    const registry = emptyRegistry();

    expect(getTool(registry, 'anything')).toBeUndefined();
  });
});

describe('buildRegistry — resource lookup', () => {
  test('builds resourceLookup with prefixed URIs', () => {
    const plugin = makePlugin({
      resources: [
        { uri: 'test://items', name: 'Items', description: 'List of items' },
        { uri: 'test://config', name: 'Config' },
      ],
    });
    const registry = buildRegistry([plugin], []);

    expect(registry.resourceLookup.size).toBe(2);
    expect(registry.resourceLookup.get('opentabs+test://test://items')).toEqual({
      pluginName: 'test',
      originalUri: 'test://items',
    });
    expect(registry.resourceLookup.get('opentabs+test://test://config')).toEqual({
      pluginName: 'test',
      originalUri: 'test://config',
    });
  });

  test('empty resources produces empty resourceLookup', () => {
    const plugin = makePlugin({ resources: [] });
    const registry = buildRegistry([plugin], []);

    expect(registry.resourceLookup.size).toBe(0);
  });

  test('multiple plugins with resources produce separate lookup entries', () => {
    const pluginA = makePlugin({
      name: 'alpha',
      resources: [{ uri: 'alpha://data', name: 'Data' }],
    });
    const pluginB = makePlugin({
      name: 'beta',
      resources: [{ uri: 'beta://data', name: 'Data' }],
    });
    const registry = buildRegistry([pluginA, pluginB], []);

    expect(registry.resourceLookup.size).toBe(2);
    expect(registry.resourceLookup.has('opentabs+alpha://alpha://data')).toBe(true);
    expect(registry.resourceLookup.has('opentabs+beta://beta://data')).toBe(true);
  });
});

describe('buildRegistry — prompt lookup', () => {
  test('builds promptLookup with prefixed names', () => {
    const plugin = makePlugin({
      prompts: [
        { name: 'greet', description: 'Greeting prompt', arguments: [{ name: 'name', required: true }] },
        { name: 'summarize', description: 'Summarize prompt' },
      ],
    });
    const registry = buildRegistry([plugin], []);

    expect(registry.promptLookup.size).toBe(2);
    expect(registry.promptLookup.get('test_greet')).toEqual({
      pluginName: 'test',
      originalName: 'greet',
    });
    expect(registry.promptLookup.get('test_summarize')).toEqual({
      pluginName: 'test',
      originalName: 'summarize',
    });
  });

  test('empty prompts produces empty promptLookup', () => {
    const plugin = makePlugin({ prompts: [] });
    const registry = buildRegistry([plugin], []);

    expect(registry.promptLookup.size).toBe(0);
  });
});

describe('getResource', () => {
  test('returns plugin and resource for a valid prefixed URI', () => {
    const plugin = makePlugin({
      resources: [{ uri: 'test://items', name: 'Items', description: 'Test items' }],
    });
    const registry = buildRegistry([plugin], []);

    const result = getResource(registry, 'opentabs+test://test://items');
    expect(result).toBeDefined();
    expect(result?.plugin).toBe(plugin);
    expect(result?.resource.uri).toBe('test://items');
    expect(result?.resource.name).toBe('Items');
  });

  test('returns undefined for unknown URI', () => {
    const registry = buildRegistry([makePlugin()], []);
    expect(getResource(registry, 'opentabs+test://nonexistent')).toBeUndefined();
  });

  test('returns undefined for empty registry', () => {
    const registry = emptyRegistry();
    expect(getResource(registry, 'anything')).toBeUndefined();
  });
});

describe('getPrompt', () => {
  test('returns plugin and prompt for a valid prefixed name', () => {
    const plugin = makePlugin({
      prompts: [{ name: 'greet', description: 'Greet', arguments: [{ name: 'name', required: true }] }],
    });
    const registry = buildRegistry([plugin], []);

    const result = getPrompt(registry, 'test_greet');
    expect(result).toBeDefined();
    expect(result?.plugin).toBe(plugin);
    expect(result?.prompt.name).toBe('greet');
    expect(result?.prompt.description).toBe('Greet');
  });

  test('returns undefined for unknown prompt name', () => {
    const registry = buildRegistry([makePlugin()], []);
    expect(getPrompt(registry, 'test_nonexistent')).toBeUndefined();
  });

  test('returns undefined for empty registry', () => {
    const registry = emptyRegistry();
    expect(getPrompt(registry, 'anything')).toBeUndefined();
  });
});

describe('listAllResources', () => {
  test('returns all resources with prefixed URIs', () => {
    const plugin = makePlugin({
      resources: [
        { uri: 'test://items', name: 'Items', description: 'Test items', mimeType: 'application/json' },
        { uri: 'test://config', name: 'Config' },
      ],
    });
    const registry = buildRegistry([plugin], []);

    const resources = listAllResources(registry);
    expect(resources).toHaveLength(2);
    expect(resources[0]).toEqual({
      uri: 'opentabs+test://test://items',
      name: 'Items',
      description: 'Test items',
      mimeType: 'application/json',
    });
    expect(resources[1]).toEqual({
      uri: 'opentabs+test://test://config',
      name: 'Config',
      description: undefined,
      mimeType: undefined,
    });
  });

  test('returns empty array for empty registry', () => {
    const registry = emptyRegistry();
    expect(listAllResources(registry)).toHaveLength(0);
  });

  test('collects resources from multiple plugins', () => {
    const pluginA = makePlugin({
      name: 'alpha',
      resources: [{ uri: 'alpha://data', name: 'A Data' }],
    });
    const pluginB = makePlugin({
      name: 'beta',
      resources: [{ uri: 'beta://data', name: 'B Data' }],
    });
    const registry = buildRegistry([pluginA, pluginB], []);

    const resources = listAllResources(registry);
    expect(resources).toHaveLength(2);
    const uris = resources.map(r => r.uri);
    expect(uris).toContain('opentabs+alpha://alpha://data');
    expect(uris).toContain('opentabs+beta://beta://data');
  });
});

describe('listAllPrompts', () => {
  test('returns all prompts with prefixed names and arguments', () => {
    const plugin = makePlugin({
      prompts: [
        { name: 'greet', description: 'Greet', arguments: [{ name: 'name', required: true }] },
        { name: 'summarize' },
      ],
    });
    const registry = buildRegistry([plugin], []);

    const prompts = listAllPrompts(registry);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toEqual({
      name: 'test_greet',
      description: 'Greet',
      arguments: [{ name: 'name', required: true }],
    });
    expect(prompts[1]).toEqual({
      name: 'test_summarize',
      description: undefined,
      arguments: undefined,
    });
  });

  test('returns empty array for empty registry', () => {
    const registry = emptyRegistry();
    expect(listAllPrompts(registry)).toHaveLength(0);
  });

  test('collects prompts from multiple plugins', () => {
    const pluginA = makePlugin({
      name: 'alpha',
      prompts: [{ name: 'greet', description: 'A greeting' }],
    });
    const pluginB = makePlugin({
      name: 'beta',
      prompts: [{ name: 'greet', description: 'B greeting' }],
    });
    const registry = buildRegistry([pluginA, pluginB], []);

    const prompts = listAllPrompts(registry);
    expect(prompts).toHaveLength(2);
    const names = prompts.map(p => p.name);
    expect(names).toContain('alpha_greet');
    expect(names).toContain('beta_greet');
  });
});
