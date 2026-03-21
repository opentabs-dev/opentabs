import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { ConfigSchema, LucideIconName, OpenTabsPlugin, ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  convertToolSchemas,
  deriveDisplayName,
  formatBytes,
  formatTimestamp,
  generateManifest,
  generateToolsManifest,
  minifySvg,
  readAndValidateIcons,
  resolvePluginPathForComparison,
  validatePlugin,
} from './build.js';

/** Write a file to the temp directory, awaiting the result. */
const writeTestFile = async (path: string, content: string): Promise<void> => {
  await writeFile(path, content, 'utf-8');
};

/**
 * Creates a minimal valid plugin for testing. Override fields as needed.
 * validatePlugin only reads: name, description, urlPatterns, tools
 * (and on each tool: name, description). The Zod schemas (input/output) and
 * methods (handle/isReady) are never inspected, so they can be stubs.
 */
const makePlugin = (overrides: Partial<OpenTabsPlugin> = {}): OpenTabsPlugin =>
  ({
    name: 'test-plugin',
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

    test('allows empty urlPatterns when configSchema has a required url field', () => {
      const configSchema: ConfigSchema = {
        instance_url: { type: 'url', label: 'Instance URL', required: true },
      };
      const errors = validatePlugin(makePlugin({ urlPatterns: [], configSchema }));
      expect(errors.some(e => e.toLowerCase().includes('url pattern'))).toBe(false);
    });

    test('rejects empty urlPatterns when configSchema has no required url field', () => {
      const configSchema: ConfigSchema = {
        api_key: { type: 'string', label: 'API Key', required: true },
      };
      const errors = validatePlugin(makePlugin({ urlPatterns: [], configSchema }));
      expect(errors.some(e => e.toLowerCase().includes('url pattern'))).toBe(true);
    });

    test('rejects empty urlPatterns when configSchema has non-required url field', () => {
      const configSchema: ConfigSchema = {
        instance_url: { type: 'url', label: 'Instance URL', required: false },
      };
      const errors = validatePlugin(makePlugin({ urlPatterns: [], configSchema }));
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

    test('omitted icon passes validation (defaults to wrench during build)', () => {
      const tool = makeTool();
      delete (tool as unknown as Record<string, unknown>).icon;
      expect(validatePlugin(makePlugin({ tools: [tool] }))).toEqual([]);
    });
  });

  describe('tools — displayName', () => {
    test('tool with empty displayName string produces a validation error', () => {
      const errors = validatePlugin(makePlugin({ tools: [makeTool({ displayName: '' })] }));
      expect(errors.some(e => e.includes('empty displayName'))).toBe(true);
    });

    test('tool with explicit displayName passes validation', () => {
      expect(validatePlugin(makePlugin({ tools: [makeTool({ displayName: 'Send Message' })] }))).toEqual([]);
    });

    test('tool with omitted displayName passes validation (auto-derived during build)', () => {
      const tool = makeTool();
      delete (tool as unknown as Record<string, unknown>).displayName;
      expect(validatePlugin(makePlugin({ tools: [tool] }))).toEqual([]);
    });
  });

  // -- Multiple errors --
  test('collects multiple errors from different fields', () => {
    const errors = validatePlugin(
      makePlugin({
        name: '',
        description: '',
        urlPatterns: [],
        tools: [],
      }),
    );
    // Should have at least one error for each invalid field
    expect(errors.length).toBeGreaterThanOrEqual(3);
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
// deriveDisplayName
// ---------------------------------------------------------------------------

describe('deriveDisplayName', () => {
  test('converts snake_case to Title Case', () => {
    expect(deriveDisplayName('send_message')).toBe('Send Message');
  });

  test('handles single word', () => {
    expect(deriveDisplayName('list')).toBe('List');
  });

  test('handles multiple underscores', () => {
    expect(deriveDisplayName('get_user_profile')).toBe('Get User Profile');
  });

  test('handles empty string', () => {
    expect(deriveDisplayName('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// generateToolsManifest — displayName and icon defaults
// ---------------------------------------------------------------------------

describe('generateToolsManifest — displayName and icon defaults', () => {
  test('uses explicit displayName and icon when provided', () => {
    const plugin = makePlugin({
      tools: [
        {
          ...makeRealTool({ name: 'send_message' }),
          displayName: 'Custom Name',
          icon: 'mail',
        } as unknown as ToolDefinition,
      ],
    });
    const manifest = generateToolsManifest(plugin);
    expect(manifest).toHaveLength(1);
    expect(manifest[0]?.displayName).toBe('Custom Name');
    expect(manifest[0]?.icon).toBe('mail');
  });

  test('auto-derives displayName from name when omitted', () => {
    const tool = makeRealTool({ name: 'send_message' });
    delete (tool as unknown as Record<string, unknown>).displayName;
    const plugin = makePlugin({ tools: [tool] });
    const manifest = generateToolsManifest(plugin);
    expect(manifest[0]?.displayName).toBe('Send Message');
  });

  test('defaults icon to wrench when omitted', () => {
    const tool = makeRealTool({ name: 'send_message' });
    delete (tool as unknown as Record<string, unknown>).icon;
    const plugin = makePlugin({ tools: [tool] });
    const manifest = generateToolsManifest(plugin);
    expect(manifest[0]?.icon).toBe('wrench');
  });

  test('auto-derives both displayName and icon when both omitted', () => {
    const tool = makeRealTool({ name: 'get_user_profile' });
    delete (tool as unknown as Record<string, unknown>).displayName;
    delete (tool as unknown as Record<string, unknown>).icon;
    const plugin = makePlugin({ tools: [tool] });
    const manifest = generateToolsManifest(plugin);
    expect(manifest[0]?.displayName).toBe('Get User Profile');
    expect(manifest[0]?.icon).toBe('wrench');
  });

  test('includes group field when tool has a group', () => {
    const plugin = makePlugin({
      tools: [
        {
          ...makeRealTool({ name: 'send_message' }),
          group: 'Messages',
        } as unknown as ToolDefinition,
      ],
    });
    const manifest = generateToolsManifest(plugin);
    expect(manifest[0]?.group).toBe('Messages');
  });

  test('omits group field when tool has no group', () => {
    const plugin = makePlugin({ tools: [makeRealTool({ name: 'send_message' })] });
    const manifest = generateToolsManifest(plugin);
    expect(manifest[0]).not.toHaveProperty('group');
  });
});

// ---------------------------------------------------------------------------
// generateManifest
// ---------------------------------------------------------------------------

describe('generateManifest', () => {
  test('produces { sdkVersion, tools } structure', () => {
    const plugin = makePlugin({ tools: [makeRealTool()] });
    const manifest = generateManifest(plugin, '0.0.10');
    expect(manifest.sdkVersion).toBe('0.0.10');
    expect(Array.isArray(manifest.tools)).toBe(true);
  });

  test('includes iconSvg and iconInactiveSvg when icons are provided', () => {
    const plugin = makePlugin({ tools: [makeRealTool()] });
    const icons = {
      iconSvg: '<svg viewBox="0 0 32 32"><circle/></svg>',
      iconInactiveSvg: '<svg viewBox="0 0 32 32"><circle fill="#808080"/></svg>',
    };
    const manifest = generateManifest(plugin, '0.0.10', icons);
    expect(manifest.iconSvg).toBe(icons.iconSvg);
    expect(manifest.iconInactiveSvg).toBe(icons.iconInactiveSvg);
  });

  test('omits icon fields when no icons are provided', () => {
    const plugin = makePlugin({ tools: [makeRealTool()] });
    const manifest = generateManifest(plugin, '0.0.10');
    expect(manifest).not.toHaveProperty('iconSvg');
    expect(manifest).not.toHaveProperty('iconInactiveSvg');
  });

  test('omits icon fields when icons object has no values', () => {
    const plugin = makePlugin({ tools: [makeRealTool()] });
    const manifest = generateManifest(plugin, '0.0.10', {});
    expect(manifest).not.toHaveProperty('iconSvg');
    expect(manifest).not.toHaveProperty('iconInactiveSvg');
  });

  test('includes configSchema when plugin defines one', () => {
    const configSchema: ConfigSchema = {
      instance_url: { type: 'url', label: 'Instance URL', required: true },
      api_key: { type: 'string', label: 'API Key' },
    };
    const plugin = makePlugin({ tools: [makeRealTool()], configSchema });
    const manifest = generateManifest(plugin, '0.0.10');
    expect(manifest.configSchema).toEqual(configSchema);
  });

  test('omits configSchema when plugin does not define one', () => {
    const plugin = makePlugin({ tools: [makeRealTool()] });
    const manifest = generateManifest(plugin, '0.0.10');
    expect(manifest).not.toHaveProperty('configSchema');
  });

  test('omits configSchema when it is an empty object', () => {
    const plugin = makePlugin({ tools: [makeRealTool()], configSchema: {} });
    const manifest = generateManifest(plugin, '0.0.10');
    expect(manifest).not.toHaveProperty('configSchema');
  });
});

// ---------------------------------------------------------------------------
// minifySvg
// ---------------------------------------------------------------------------

describe('minifySvg', () => {
  test('removes XML comments', () => {
    const input = '<svg><!-- comment --><rect/></svg>';
    expect(minifySvg(input)).toBe('<svg><rect/></svg>');
  });

  test('removes multi-line XML comments', () => {
    const input = '<svg>\n<!-- multi\nline\ncomment -->\n<rect/></svg>';
    expect(minifySvg(input)).toBe('<svg> <rect/></svg>');
  });

  test('collapses whitespace between tags', () => {
    const input = '<svg>   <rect/>   <circle/>   </svg>';
    expect(minifySvg(input)).toBe('<svg> <rect/> <circle/> </svg>');
  });

  test('collapses runs of whitespace to single space', () => {
    const input = '<svg   viewBox="0 0 32 32">  <rect  /></svg>';
    expect(minifySvg(input)).toBe('<svg viewBox="0 0 32 32"> <rect /></svg>');
  });

  test('trims leading and trailing whitespace', () => {
    const input = '  \n  <svg><rect/></svg>  \n  ';
    expect(minifySvg(input)).toBe('<svg><rect/></svg>');
  });

  test('handles already-minified SVGs', () => {
    const input = '<svg viewBox="0 0 32 32"><rect/></svg>';
    expect(minifySvg(input)).toBe(input);
  });

  test('handles empty SVG', () => {
    expect(minifySvg('<svg></svg>')).toBe('<svg></svg>');
  });

  test('removes multiple comments', () => {
    const input = '<svg><!-- a --><rect/><!-- b --><circle/></svg>';
    expect(minifySvg(input)).toBe('<svg><rect/><circle/></svg>');
  });

  test('preserves attribute values with spaces', () => {
    const input = '<svg viewBox="0 0 32 32">\n  <rect fill="rgb(255, 0, 0)"/>\n</svg>';
    expect(minifySvg(input)).toBe('<svg viewBox="0 0 32 32"> <rect fill="rgb(255, 0, 0)"/> </svg>');
  });
});

// ---------------------------------------------------------------------------
// readAndValidateIcons
// ---------------------------------------------------------------------------

const VALID_ICON_SVG =
  '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="12" fill="#ff0000"/></svg>';
const VALID_INACTIVE_SVG =
  '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="12" fill="#808080"/></svg>';

describe('readAndValidateIcons', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-icon-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns empty when no icon files exist', async () => {
    const result = await readAndValidateIcons(tmpDir, 'test-plugin');
    expect(result).toEqual({});
  });

  test('auto-generates inactive icon when only icon.svg exists', async () => {
    await writeTestFile(join(tmpDir, 'icon.svg'), VALID_ICON_SVG);
    const result = await readAndValidateIcons(tmpDir, 'test-plugin');
    expect(result.iconSvg).toBeDefined();
    expect(result.iconInactiveSvg).toBeDefined();
    // The active icon preserves original colors and is minified
    expect(result.iconSvg).toContain('#ff0000');
    expect(result.iconSvg).toContain('viewBox="0 0 32 32"');
    // The inactive icon should have grayscale colors (no red)
    expect(result.iconInactiveSvg).not.toContain('#ff0000');
  });

  test('uses manual override when both icon files exist', async () => {
    await writeTestFile(join(tmpDir, 'icon.svg'), VALID_ICON_SVG);
    await writeTestFile(join(tmpDir, 'icon-inactive.svg'), VALID_INACTIVE_SVG);
    const result = await readAndValidateIcons(tmpDir, 'test-plugin');
    expect(result.iconSvg).toBeDefined();
    expect(result.iconInactiveSvg).toBeDefined();
    // Manual override should contain the original gray value
    expect(result.iconInactiveSvg).toContain('#808080');
  });

  test('throws when icon-inactive.svg exists without icon.svg', async () => {
    await writeTestFile(join(tmpDir, 'icon-inactive.svg'), VALID_INACTIVE_SVG);
    await expect(readAndValidateIcons(tmpDir, 'test-plugin')).rejects.toThrow('icon-inactive.svg requires icon.svg');
  });

  test('throws when icon.svg is invalid (missing viewBox)', async () => {
    await writeTestFile(join(tmpDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    await expect(readAndValidateIcons(tmpDir, 'test-plugin')).rejects.toThrow('icon.svg validation failed');
  });

  test('throws when icon.svg has non-square viewBox', async () => {
    const nonSquare = '<svg viewBox="0 0 32 24" xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    await writeTestFile(join(tmpDir, 'icon.svg'), nonSquare);
    await expect(readAndValidateIcons(tmpDir, 'test-plugin')).rejects.toThrow('icon.svg validation failed');
  });

  test('throws when icon-inactive.svg has invalid structure', async () => {
    await writeTestFile(join(tmpDir, 'icon.svg'), VALID_ICON_SVG);
    await writeTestFile(
      join(tmpDir, 'icon-inactive.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#808080"/></svg>',
    );
    await expect(readAndValidateIcons(tmpDir, 'test-plugin')).rejects.toThrow('icon-inactive.svg validation failed');
  });

  test('throws when icon-inactive.svg has saturated colors', async () => {
    const coloredInactive =
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><circle fill="#ff0000"/></svg>';
    await writeTestFile(join(tmpDir, 'icon.svg'), VALID_ICON_SVG);
    await writeTestFile(join(tmpDir, 'icon-inactive.svg'), coloredInactive);
    await expect(readAndValidateIcons(tmpDir, 'test-plugin')).rejects.toThrow(
      'icon-inactive.svg color validation failed',
    );
  });

  test('minifies SVGs before returning', async () => {
    const unminified = [
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">',
      '  <!-- Active icon -->',
      '  <circle cx="16" cy="16" r="12" fill="#ff0000"/>',
      '</svg>',
    ].join('\n');
    await writeTestFile(join(tmpDir, 'icon.svg'), unminified);
    const result = await readAndValidateIcons(tmpDir, 'test-plugin');
    expect(result.iconSvg).not.toContain('<!--');
    expect(result.iconSvg).not.toContain('\n');
  });

  test('auto-generated inactive icon does not contain original colors', async () => {
    const multiColor =
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect fill="#ff0000"/><circle stroke="#00ff00"/></svg>';
    await writeTestFile(join(tmpDir, 'icon.svg'), multiColor);
    const result = await readAndValidateIcons(tmpDir, 'test-plugin');
    expect(result.iconInactiveSvg).not.toContain('#ff0000');
    expect(result.iconInactiveSvg).not.toContain('#00ff00');
  });

  test('namespaces gradient IDs in all four icon variants', async () => {
    const svgWithGradient =
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1"><stop stop-color="#ff0000"/></linearGradient></defs><rect fill="url(#g1)"/></svg>';
    await writeTestFile(join(tmpDir, 'icon.svg'), svgWithGradient);
    const result = await readAndValidateIcons(tmpDir, 'myplugin');
    // All four variants should have the namespaced ID
    expect(result.iconSvg).toContain('id="myplugin-g1"');
    expect(result.iconSvg).toContain('url(#myplugin-g1)');
    expect(result.iconSvg).not.toContain('id="g1"');
    expect(result.iconInactiveSvg).toContain('id="myplugin-g1"');
    expect(result.iconDarkSvg).toContain('id="myplugin-g1"');
    expect(result.iconDarkInactiveSvg).toContain('id="myplugin-g1"');
  });

  test('auto-generated inactive icon contains namespaced IDs', async () => {
    const svgWithGradient =
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"><stop stop-color="#ff0000"/></linearGradient></defs><rect fill="url(#a)"/></svg>';
    await writeTestFile(join(tmpDir, 'icon.svg'), svgWithGradient);
    const result = await readAndValidateIcons(tmpDir, 'jira');
    // The auto-generated inactive variant should have namespaced IDs
    expect(result.iconInactiveSvg).toContain('id="jira-a"');
    expect(result.iconInactiveSvg).toContain('url(#jira-a)');
    // Original generic ID should NOT be present
    expect(result.iconInactiveSvg).not.toMatch(/id="a"/);
  });

  test('icons without IDs are unaffected by namespacing', async () => {
    await writeTestFile(join(tmpDir, 'icon.svg'), VALID_ICON_SVG);
    const result = await readAndValidateIcons(tmpDir, 'test-plugin');
    expect(result.iconSvg).toContain('#ff0000');
    expect(result.iconSvg).not.toContain('test-plugin-');
  });
});

describe('resolvePluginPathForComparison', () => {
  const isWin = process.platform === 'win32';
  const configDir = isWin ? 'C:\\Users\\user\\.opentabs' : '/home/user/.opentabs';

  test('absolute path is returned as-is', () => {
    const absPath = isWin ? 'C:\\Users\\me\\plugins\\my-plugin' : '/Users/me/plugins/my-plugin';
    expect(resolvePluginPathForComparison(absPath, configDir)).toBe(absPath);
  });

  test('home-relative path is expanded against homedir', () => {
    const result = resolvePluginPathForComparison('~/plugins/my-plugin', configDir);
    expect(isAbsolute(result)).toBe(true);
    expect(result).toContain(join('plugins', 'my-plugin'));
    expect(result).not.toContain('~');
  });

  test('relative path is resolved against configDir', () => {
    expect(resolvePluginPathForComparison('my-plugin', configDir)).toBe(join(configDir, 'my-plugin'));
  });

  test('relative path with subdirectory components is resolved against configDir', () => {
    expect(resolvePluginPathForComparison('../other/plugin', configDir)).toBe(resolve(configDir, '../other/plugin'));
  });
});
