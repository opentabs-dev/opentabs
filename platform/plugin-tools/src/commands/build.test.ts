import {
  convertToolSchemas,
  formatBytes,
  formatTimestamp,
  generateManifest,
  generatePromptsManifest,
  generateResourcesManifest,
  validatePlugin,
} from './build.js';
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type {
  LucideIconName,
  OpenTabsPlugin,
  PromptDefinition,
  ResourceDefinition,
  ToolDefinition,
} from '@opentabs-dev/plugin-sdk';

/**
 * Creates a minimal valid plugin for testing. Override fields as needed.
 * validatePlugin only reads: name, version, description, urlPatterns, tools
 * (and on each tool: name, description). The Zod schemas (input/output) and
 * methods (handle/isReady) are never inspected, so they can be stubs.
 */
const makePlugin = (overrides: Partial<OpenTabsPlugin> = {}): OpenTabsPlugin =>
  ({
    name: 'test-plugin',
    version: '1.0.0',
    displayName: 'Test Plugin',
    description: 'A test plugin',
    urlPatterns: ['https://example.com/*'],
    tools: [makeTool()],
    ...overrides,
  }) as unknown as OpenTabsPlugin;

const makeTool = (
  overrides: Partial<Pick<ToolDefinition, 'name' | 'displayName' | 'description' | 'icon'>> = {},
): ToolDefinition =>
  ({
    name: 'test_tool',
    displayName: 'Test Tool',
    description: 'A test tool',
    icon: 'wrench',
    ...overrides,
  }) as unknown as ToolDefinition;

// ---------------------------------------------------------------------------
// validatePlugin
// ---------------------------------------------------------------------------

describe('validatePlugin', () => {
  test('returns empty array for a valid plugin', () => {
    expect(validatePlugin(makePlugin())).toEqual([]);
  });

  // -- Name validation --
  describe('name', () => {
    test('rejects empty name', () => {
      const errors = validatePlugin(makePlugin({ name: '' }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.toLowerCase().includes('name'))).toBe(true);
    });

    test('rejects name with uppercase letters', () => {
      const errors = validatePlugin(makePlugin({ name: 'MyPlugin' }));
      expect(errors.length).toBeGreaterThan(0);
    });

    test('rejects reserved name', () => {
      const errors = validatePlugin(makePlugin({ name: 'browser' }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('reserved'))).toBe(true);
    });

    test('accepts valid hyphenated name', () => {
      expect(validatePlugin(makePlugin({ name: 'my-plugin' }))).toEqual([]);
    });
  });

  // -- Version validation --
  describe('version', () => {
    test('rejects empty version', () => {
      const errors = validatePlugin(makePlugin({ version: '' }));
      expect(errors.some(e => e.toLowerCase().includes('version'))).toBe(true);
    });

    test('rejects non-semver version', () => {
      const errors = validatePlugin(makePlugin({ version: 'v1' }));
      expect(errors.some(e => e.includes('semver'))).toBe(true);
    });

    test('rejects version with only major.minor', () => {
      const errors = validatePlugin(makePlugin({ version: '1.0' }));
      expect(errors.some(e => e.includes('semver'))).toBe(true);
    });

    test('accepts valid semver', () => {
      expect(validatePlugin(makePlugin({ version: '1.0.0' }))).toEqual([]);
      expect(validatePlugin(makePlugin({ version: '0.1.0' }))).toEqual([]);
    });

    test('accepts semver with prerelease tag', () => {
      expect(validatePlugin(makePlugin({ version: '1.0.0-beta.1' }))).toEqual([]);
      expect(validatePlugin(makePlugin({ version: '0.0.1-alpha' }))).toEqual([]);
    });
  });

  // -- Description validation --
  describe('description', () => {
    test('rejects empty description', () => {
      const errors = validatePlugin(makePlugin({ description: '' }));
      expect(errors.some(e => e.toLowerCase().includes('description'))).toBe(true);
    });

    test('accepts non-empty description', () => {
      expect(validatePlugin(makePlugin({ description: 'Works' }))).toEqual([]);
    });
  });

  // -- URL patterns validation --
  describe('urlPatterns', () => {
    test('rejects empty urlPatterns array', () => {
      const errors = validatePlugin(makePlugin({ urlPatterns: [] }));
      expect(errors.some(e => e.toLowerCase().includes('url pattern'))).toBe(true);
    });

    test('rejects invalid URL pattern', () => {
      const errors = validatePlugin(makePlugin({ urlPatterns: ['not-a-pattern'] }));
      expect(errors.length).toBeGreaterThan(0);
    });

    test('rejects overly broad pattern', () => {
      const errors = validatePlugin(makePlugin({ urlPatterns: ['*://*/*'] }));
      expect(errors.some(e => e.includes('broad'))).toBe(true);
    });

    test('accepts valid pattern', () => {
      expect(validatePlugin(makePlugin({ urlPatterns: ['https://example.com/*'] }))).toEqual([]);
    });

    test('validates all patterns in the array', () => {
      const errors = validatePlugin(makePlugin({ urlPatterns: ['https://example.com/*', 'bad'] }));
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // -- Tools validation --
  describe('tools', () => {
    test('rejects empty tools array', () => {
      const errors = validatePlugin(makePlugin({ tools: [] }));
      expect(errors.some(e => e.toLowerCase().includes('tool'))).toBe(true);
    });

    test('rejects tool with empty name', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ name: '' })] }));
      expect(errors.some(e => e.includes('Tool name is required'))).toBe(true);
    });

    test('rejects tool name that is not snake_case', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ name: 'CamelCase' })] }));
      expect(errors.some(e => e.includes('snake_case'))).toBe(true);
    });

    test('rejects tool name starting with underscore', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ name: '_leading' })] }));
      expect(errors.some(e => e.includes('snake_case'))).toBe(true);
    });

    test('rejects tool name with hyphens', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ name: 'my-tool' })] }));
      expect(errors.some(e => e.includes('snake_case'))).toBe(true);
    });

    test('rejects tool with empty description', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ description: '' })] }));
      expect(errors.some(e => e.includes('missing a description'))).toBe(true);
    });

    test('rejects duplicate tool names', () => {
      const errors = validatePlugin(
        makePlugin({ tools: [makeTool({ name: 'dup_tool' }), makeTool({ name: 'dup_tool' })] }),
      );
      expect(errors.some(e => e.includes('Duplicate'))).toBe(true);
    });

    test('accepts valid snake_case tool names', () => {
      expect(validatePlugin(makePlugin({ tools: [makeTool({ name: 'send_message' })] }))).toEqual([]);
      expect(validatePlugin(makePlugin({ tools: [makeTool({ name: 'list' })] }))).toEqual([]);
      expect(validatePlugin(makePlugin({ tools: [makeTool({ name: 'a1b2' })] }))).toEqual([]);
    });

    test('accepts multiple valid tools', () => {
      const tools = [makeTool({ name: 'tool_a' }), makeTool({ name: 'tool_b' })];
      expect(validatePlugin(makePlugin({ tools }))).toEqual([]);
    });

    test('rejects tool name starting with a digit', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ name: '1tool' })] }));
      expect(errors.some(e => e.includes('snake_case'))).toBe(true);
    });

    test('produces two errors for tool with both empty name and empty description', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ name: '', description: '' })] }));
      expect(errors.filter(e => e.includes('name') || e.includes('description'))).toHaveLength(2);
    });
  });

  // -- Plugin displayName validation --
  describe('displayName', () => {
    test('empty displayName string produces a validation error', () => {
      const errors = validatePlugin(makePlugin({ displayName: '' }));
      expect(errors.some(e => e.toLowerCase().includes('displayname'))).toBe(true);
    });

    test('valid displayName passes validation', () => {
      expect(validatePlugin(makePlugin({ displayName: 'My Plugin' }))).toEqual([]);
    });
  });

  // -- Tool icon and displayName validation --
  describe('tools — icon', () => {
    test('invalid icon name (not in LUCIDE_ICON_NAMES) produces a validation error', () => {
      // Cast needed because icon is typed as LucideIconName — we're intentionally passing an invalid value
      const errors = validatePlugin(
        makePlugin({ tools: [makeTool({ icon: 'nonexistent-icon-name' as unknown as LucideIconName })] }),
      );
      expect(errors.some(e => e.includes('invalid icon'))).toBe(true);
    });

    test('valid icon name passes validation', () => {
      expect(validatePlugin(makePlugin({ tools: [makeTool({ icon: 'wrench' })] }))).toEqual([]);
    });
  });

  describe('tools — displayName', () => {
    test('tool with empty displayName produces a validation error', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ displayName: '' })] }));
      expect(errors.some(e => e.includes('missing a displayName'))).toBe(true);
    });

    test('tool with valid displayName passes validation', () => {
      expect(validatePlugin(makePlugin({ tools: [makeTool({ displayName: 'Send Message' })] }))).toEqual([]);
    });
  });

  // -- Multiple errors --
  test('collects multiple errors from different fields', () => {
    const errors = validatePlugin(
      makePlugin({
        name: '',
        version: '',
        description: '',
        urlPatterns: [],
        tools: [],
      }),
    );
    // Should have at least one error for each invalid field
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// convertToolSchemas
// ---------------------------------------------------------------------------

/** Creates a ToolDefinition with real Zod schemas for convertToolSchemas tests. */
const makeRealTool = (
  overrides: Partial<Pick<ToolDefinition, 'name' | 'description' | 'input' | 'output'>> = {},
): ToolDefinition =>
  ({
    name: 'test_tool',
    description: 'A test tool',
    input: z.object({ name: z.string() }),
    output: z.object({ ok: z.boolean() }),
    handle: () => Promise.resolve({ ok: true }),
    ...overrides,
  }) as unknown as ToolDefinition;

describe('convertToolSchemas', () => {
  test('converts a valid Zod object schema to JSON Schema with correct structure', () => {
    const tool = makeRealTool({
      input: z.object({ name: z.string(), count: z.number().optional() }),
      output: z.object({ ok: z.boolean() }),
    });
    const { inputSchema, outputSchema } = convertToolSchemas(tool);

    expect(inputSchema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['name'],
      additionalProperties: false,
    });
    expect(outputSchema).toEqual({
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
      required: ['ok'],
      additionalProperties: false,
    });
  });

  test('strips $schema key from both input and output schemas', () => {
    const tool = makeRealTool();
    const { inputSchema, outputSchema } = convertToolSchemas(tool);

    expect(inputSchema).not.toHaveProperty('$schema');
    expect(outputSchema).not.toHaveProperty('$schema');
  });

  test('throws when input schema uses .transform()', () => {
    const tool = makeRealTool({
      input: z.object({ name: z.string().transform(s => s.toUpperCase()) }) as unknown as z.ZodObject<z.ZodRawShape>,
    });
    expect(() => convertToolSchemas(tool)).toThrow(/cannot use \.transform\(\)/);
  });

  test('throws when output schema uses .transform()', () => {
    const tool = makeRealTool({
      output: z.object({ upper: z.string().transform(s => s.toUpperCase()) }),
    });
    expect(() => convertToolSchemas(tool)).toThrow(/cannot use \.transform\(\)/);
  });

  test('converts nested objects and arrays correctly', () => {
    const tool = makeRealTool({
      input: z.object({
        tags: z.array(z.string()),
        meta: z.object({ key: z.string(), value: z.string() }),
      }),
      output: z.object({ results: z.array(z.number()) }),
    });
    const { inputSchema, outputSchema } = convertToolSchemas(tool);

    expect(inputSchema).toEqual({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        meta: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['key', 'value'],
          additionalProperties: false,
        },
      },
      required: ['tags', 'meta'],
      additionalProperties: false,
    });
    expect(outputSchema).toEqual({
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'number' } },
      },
      required: ['results'],
      additionalProperties: false,
    });
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe('formatBytes', () => {
  test('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  test('formats bytes below 1024', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  test('formats 1023 bytes (boundary before KB)', () => {
    expect(formatBytes(1023)).toBe('1023 B');
  });

  test('formats exactly 1024 bytes as KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  test('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  test('formats 1048575 bytes (boundary before MB)', () => {
    expect(formatBytes(1048575)).toBe('1024.0 KB');
  });

  test('formats exactly 1048576 bytes as MB', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  test('formats megabytes', () => {
    expect(formatBytes(5242880)).toBe('5.0 MB');
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe('formatTimestamp', () => {
  test('returns a string matching HH:MM:SS format', () => {
    expect(formatTimestamp()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// validatePlugin — resource validation
// ---------------------------------------------------------------------------

describe('validatePlugin — resources', () => {
  const makeResource = (overrides: Partial<ResourceDefinition> = {}): ResourceDefinition =>
    ({
      uri: 'test://items',
      name: 'Test Items',
      read: () => Promise.resolve({ uri: 'test://items', text: '[]' }),
      ...overrides,
    }) as ResourceDefinition;

  test('valid plugin with resources passes validation', () => {
    expect(validatePlugin(makePlugin({ resources: [makeResource()] }))).toEqual([]);
  });

  test('plugin with no resources passes validation', () => {
    expect(validatePlugin(makePlugin())).toEqual([]);
  });

  test('rejects resource with empty URI', () => {
    const errors = validatePlugin(makePlugin({ resources: [makeResource({ uri: '' })] }));
    expect(errors.some(e => e.includes('Resource URI is required'))).toBe(true);
  });

  test('rejects resource with empty name', () => {
    const errors = validatePlugin(makePlugin({ resources: [makeResource({ name: '' })] }));
    expect(errors.some(e => e.includes('missing a name'))).toBe(true);
  });

  test('rejects duplicate resource URIs', () => {
    const errors = validatePlugin(
      makePlugin({ resources: [makeResource({ uri: 'test://a' }), makeResource({ uri: 'test://a' })] }),
    );
    expect(errors.some(e => e.includes('Duplicate resource URI'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePlugin — prompt validation
// ---------------------------------------------------------------------------

describe('validatePlugin — prompts', () => {
  const makePrompt = (overrides: Partial<PromptDefinition> = {}): PromptDefinition =>
    ({
      name: 'greet',
      render: () => Promise.resolve([{ role: 'user', content: { type: 'text', text: 'Hello' } }]),
      ...overrides,
    }) as PromptDefinition;

  test('valid plugin with prompts passes validation', () => {
    expect(validatePlugin(makePlugin({ prompts: [makePrompt()] }))).toEqual([]);
  });

  test('plugin with no prompts passes validation', () => {
    expect(validatePlugin(makePlugin())).toEqual([]);
  });

  test('rejects prompt with empty name', () => {
    const errors = validatePlugin(makePlugin({ prompts: [makePrompt({ name: '' })] }));
    expect(errors.some(e => e.includes('Prompt name is required'))).toBe(true);
  });

  test('rejects prompt name with uppercase letters', () => {
    const errors = validatePlugin(makePlugin({ prompts: [makePrompt({ name: 'MyPrompt' })] }));
    expect(errors.some(e => e.includes('must match'))).toBe(true);
  });

  test('accepts prompt names with hyphens and underscores', () => {
    expect(validatePlugin(makePlugin({ prompts: [makePrompt({ name: 'my-prompt' })] }))).toEqual([]);
    expect(validatePlugin(makePlugin({ prompts: [makePrompt({ name: 'my_prompt' })] }))).toEqual([]);
  });

  test('rejects prompt with empty argument name', () => {
    const errors = validatePlugin(makePlugin({ prompts: [makePrompt({ arguments: [{ name: '' }] })] }));
    expect(errors.some(e => e.includes('empty name'))).toBe(true);
  });

  test('rejects duplicate prompt names', () => {
    const errors = validatePlugin(
      makePlugin({ prompts: [makePrompt({ name: 'greet' }), makePrompt({ name: 'greet' })] }),
    );
    expect(errors.some(e => e.includes('Duplicate prompt name'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateResourcesManifest
// ---------------------------------------------------------------------------

describe('generateResourcesManifest', () => {
  test('extracts serializable resource metadata', () => {
    const resources: ResourceDefinition[] = [
      {
        uri: 'test://items',
        name: 'Items',
        description: 'List of items',
        mimeType: 'application/json',
        read: () => Promise.resolve({ uri: 'test://items', text: '[]' }),
      },
    ];
    const result = generateResourcesManifest(resources);
    expect(result).toEqual([
      { uri: 'test://items', name: 'Items', description: 'List of items', mimeType: 'application/json' },
    ]);
  });

  test('omits undefined optional fields', () => {
    const resources: ResourceDefinition[] = [
      {
        uri: 'test://data',
        name: 'Data',
        read: () => Promise.resolve({ uri: 'test://data', text: '' }),
      },
    ];
    const result = generateResourcesManifest(resources);
    expect(result).toEqual([{ uri: 'test://data', name: 'Data' }]);
    expect(result[0]).not.toHaveProperty('description');
    expect(result[0]).not.toHaveProperty('mimeType');
  });

  test('returns empty array for empty input', () => {
    expect(generateResourcesManifest([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generatePromptsManifest
// ---------------------------------------------------------------------------

describe('generatePromptsManifest', () => {
  test('extracts serializable prompt metadata', () => {
    const prompts: PromptDefinition[] = [
      {
        name: 'greet',
        description: 'Greet someone',
        arguments: [{ name: 'name', description: 'Who to greet', required: true }],
        render: () => Promise.resolve([{ role: 'user', content: { type: 'text' as const, text: 'Hi' } }]),
      },
    ];
    const result = generatePromptsManifest(prompts);
    expect(result).toEqual([
      {
        name: 'greet',
        description: 'Greet someone',
        arguments: [{ name: 'name', description: 'Who to greet', required: true }],
      },
    ]);
  });

  test('omits undefined optional fields', () => {
    const prompts: PromptDefinition[] = [
      {
        name: 'simple',
        render: () => Promise.resolve([{ role: 'user', content: { type: 'text' as const, text: 'Hi' } }]),
      },
    ];
    const result = generatePromptsManifest(prompts);
    expect(result).toEqual([{ name: 'simple' }]);
    expect(result[0]).not.toHaveProperty('description');
    expect(result[0]).not.toHaveProperty('arguments');
  });

  test('returns empty array for empty input', () => {
    expect(generatePromptsManifest([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateManifest
// ---------------------------------------------------------------------------

describe('generateManifest', () => {
  test('produces { tools, resources, prompts } structure', () => {
    const plugin = makePlugin({ tools: [makeRealTool()] });
    const manifest = generateManifest(plugin);
    expect(Array.isArray(manifest.tools)).toBe(true);
    expect(Array.isArray(manifest.resources)).toBe(true);
    expect(Array.isArray(manifest.prompts)).toBe(true);
  });

  test('resources and prompts default to empty arrays when plugin has none', () => {
    const plugin = makePlugin({ tools: [makeRealTool()] });
    const manifest = generateManifest(plugin);
    expect(manifest.resources).toEqual([]);
    expect(manifest.prompts).toEqual([]);
  });
});
