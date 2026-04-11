import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginNameFromPackage } from '@opentabs-dev/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { checkSdkCompatibility, loadPlugin, parseMajorMinor, validateTools } from './loader.js';

/**
 * Unit tests for the plugin loader module.
 *
 * Uses real temp directories with real files to exercise package.json
 * validation, IIFE reading, tools.json parsing, and name derivation.
 */

/** Minimal valid package.json with opentabs field */
const validPackageJson = (overrides: Record<string, unknown> = {}) => ({
  name: 'opentabs-plugin-test',
  version: '1.0.0',
  main: 'dist/adapter.iife.js',
  opentabs: {
    displayName: 'Test Plugin',
    description: 'A test plugin',
    urlPatterns: ['http://localhost/*'],
  },
  ...overrides,
});

/** Minimal valid tools.json array */
const validTools = (overrides: Array<Record<string, unknown>> = []) =>
  overrides.length > 0
    ? overrides
    : [
        {
          name: 'my_tool',
          displayName: 'My Tool',
          description: 'A tool',
          icon: 'wrench',
          input_schema: {},
          output_schema: {},
        },
      ];

describe('pluginNameFromPackage', () => {
  test('strips opentabs-plugin- prefix', () => {
    expect(pluginNameFromPackage('opentabs-plugin-slack')).toBe('slack');
  });

  test('handles third-party scoped packages', () => {
    expect(pluginNameFromPackage('@myorg/opentabs-plugin-jira')).toBe('myorg-jira');
  });

  test('strips official @opentabs-dev scope — treated like unscoped', () => {
    expect(pluginNameFromPackage('@opentabs-dev/opentabs-plugin-slack')).toBe('slack');
  });

  test('handles packages without the prefix', () => {
    expect(pluginNameFromPackage('some-other-package')).toBe('some-other-package');
  });
});

describe('validateTools', () => {
  test('validates a valid tools array', () => {
    const result = validateTools(validTools(), '/test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.name).toBe('my_tool');
    }
  });

  test('rejects non-array input', () => {
    const result = validateTools('not an array', '/test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('expected an array');
    }
  });

  test('rejects tool with missing name', () => {
    const result = validateTools(
      [
        {
          displayName: 'X',
          description: 'Y',
          icon: 'z',
          input_schema: {},
          output_schema: {},
        },
      ],
      '/test',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('name must be a non-empty string');
    }
  });

  test('preserves group field when present', () => {
    const result = validateTools(
      [
        {
          name: 'send_message',
          displayName: 'Send Message',
          description: 'Send a message',
          icon: 'send',
          group: 'Messages',
          input_schema: {},
          output_schema: {},
        },
      ],
      '/test',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.group).toBe('Messages');
  });

  test('omits group field when not present in input', () => {
    const result = validateTools(validTools(), '/test');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]).not.toHaveProperty('group');
  });

  test('omits group field when value is not a string', () => {
    const result = validateTools(
      [
        {
          name: 't',
          displayName: 'T',
          description: 'D',
          icon: 'i',
          group: 42,
          input_schema: {},
          output_schema: {},
        },
      ],
      '/test',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]).not.toHaveProperty('group');
  });

  test('rejects tool with description exceeding 1000 chars', () => {
    const result = validateTools(
      [
        {
          name: 't',
          displayName: 'T',
          description: 'x'.repeat(1001),
          icon: 'i',
          input_schema: {},
          output_schema: {},
        },
      ],
      '/test',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('at most 1000 characters');
    }
  });
});

describe('loadPlugin', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-loader-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** A 64-char hex string used as the embedded adapter hash in test IIFEs */
  const TEST_ADAPTER_HASH = 'a'.repeat(64);

  /**
   * Minimal IIFE content that includes the embedded __adapterHash pattern,
   * matching the output produced by the build tool's hashAndFreeze snippet.
   */
  const TEST_IIFE = `(function(){window.__test=true})();(function(){var a={};a.__adapterHash="${TEST_ADAPTER_HASH}";})()`;

  /** Write a full plugin directory structure */
  const writePlugin = (
    dir: string,
    packageJson: Record<string, unknown>,
    tools: unknown[] = validTools(),
    iifeContent = TEST_IIFE,
  ) => {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson));
    writeFileSync(join(dir, 'dist', 'tools.json'), JSON.stringify(tools));
    writeFileSync(join(dir, 'dist', 'adapter.iife.js'), iifeContent);
  };

  test('loads a valid plugin with all fields populated', async () => {
    const pluginDir = join(tmpDir, 'my-plugin');
    writePlugin(pluginDir, validPackageJson());

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('test');
    expect(result.value.version).toBe('1.0.0');
    expect(result.value.displayName).toBe('Test Plugin');
    expect(result.value.description).toBe('A test plugin');
    expect(result.value.urlPatterns).toEqual(['http://localhost/*']);
    expect(result.value.source).toBe('local');
    expect(result.value.iife).toBe(TEST_IIFE);
    expect(result.value.tools).toHaveLength(1);
    expect(result.value.tools[0]?.name).toBe('my_tool');
    expect(result.value.sourcePath).toBe(pluginDir);
    expect(result.value.npmPackageName).toBe('opentabs-plugin-test');
    expect(result.value.adapterHash).toBe(TEST_ADAPTER_HASH);
  });

  test('returns Err when package.json is missing', async () => {
    const pluginDir = join(tmpDir, 'no-pkg');
    mkdirSync(pluginDir, { recursive: true });

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('package.json');
    }
  });

  test('returns Err when IIFE file is missing', async () => {
    const pluginDir = join(tmpDir, 'no-iife');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(validPackageJson()));
    writeFileSync(join(pluginDir, 'dist', 'tools.json'), JSON.stringify(validTools()));

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  test('returns Err when IIFE file is empty', async () => {
    const pluginDir = join(tmpDir, 'empty-iife');
    writePlugin(pluginDir, validPackageJson(), validTools(), '');

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('empty');
    }
  });

  test('returns Err when IIFE exceeds 5MB size limit', async () => {
    const pluginDir = join(tmpDir, 'oversized');
    const oversizedContent = 'x'.repeat(5 * 1024 * 1024 + 1);
    writePlugin(pluginDir, validPackageJson(), validTools(), oversizedContent);

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('exceeding the 5MB limit');
    }
  });

  test('returns Err when tools.json is missing', async () => {
    const pluginDir = join(tmpDir, 'no-tools');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(validPackageJson()));
    writeFileSync(join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})()');

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('tools.json');
    }
  });

  test('returns Err when package.json has invalid opentabs field', async () => {
    const pluginDir = join(tmpDir, 'bad-opentabs');
    writePlugin(pluginDir, { ...validPackageJson(), opentabs: 'invalid' });

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('opentabs');
    }
  });

  test('derives plugin name from scoped npm package name', async () => {
    const pluginDir = join(tmpDir, 'scoped');
    writePlugin(pluginDir, validPackageJson({ name: '@myorg/opentabs-plugin-jira' }));

    const result = await loadPlugin(pluginDir, 'npm');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('myorg-jira');
    expect(result.value.npmPackageName).toBe('@myorg/opentabs-plugin-jira');
  });

  test('extracts adapterHash embedded in IIFE by build tool', async () => {
    const hashA = 'a'.repeat(64);
    const hashB = 'b'.repeat(64);
    const iifeA = `(function(){})();(function(){var a={};a.__adapterHash="${hashA}";})()`;
    const iifeB = `(function(){})();(function(){var a={};a.__adapterHash="${hashB}";})()`;
    const pluginDir1 = join(tmpDir, 'hash1');
    const pluginDir2 = join(tmpDir, 'hash2');
    writePlugin(pluginDir1, validPackageJson(), validTools(), iifeA);
    writePlugin(pluginDir2, validPackageJson(), validTools(), iifeB);

    const result1 = await loadPlugin(pluginDir1, 'local');
    const result2 = await loadPlugin(pluginDir2, 'local');

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    expect(result1.value.adapterHash).toBe(hashA);
    expect(result2.value.adapterHash).toBe(hashB);
    expect(result1.value.adapterHash).not.toBe(result2.value.adapterHash);
  });

  test('returns Err for invalid URL patterns', async () => {
    const pluginDir = join(tmpDir, 'bad-url');
    writePlugin(
      pluginDir,
      validPackageJson({
        opentabs: {
          displayName: 'X',
          description: 'Y',
          urlPatterns: ['not-a-pattern'],
        },
      }),
    );

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('URL pattern');
    }
  });

  test('preserves tool group field through full load', async () => {
    const pluginDir = join(tmpDir, 'with-group');
    writePlugin(pluginDir, validPackageJson(), [
      {
        name: 'send_message',
        displayName: 'Send Message',
        description: 'Send a message',
        icon: 'send',
        group: 'Messages',
        input_schema: {},
        output_schema: {},
      },
      {
        name: 'list_users',
        displayName: 'List Users',
        description: 'List all users',
        icon: 'users',
        input_schema: {},
        output_schema: {},
      },
    ]);

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tools).toHaveLength(2);
    expect(result.value.tools[0]?.group).toBe('Messages');
    expect(result.value.tools[1]).not.toHaveProperty('group');
  });

  test('extracts sdkVersion from manifest object format', async () => {
    const pluginDir = join(tmpDir, 'with-sdk');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(validPackageJson()));
    writeFileSync(join(pluginDir, 'dist', 'tools.json'), JSON.stringify({ sdkVersion: '0.0.16', tools: validTools() }));
    writeFileSync(join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})()');

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sdkVersion).toBe('0.0.16');
  });

  test('sets sdkVersion to undefined for legacy tools.json format (plain array)', async () => {
    const pluginDir = join(tmpDir, 'no-sdk');
    writePlugin(pluginDir, validPackageJson());

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sdkVersion).toBeUndefined();
  });

  test('returns Err for plugin with newer SDK version than server', async () => {
    const pluginDir = join(tmpDir, 'new-sdk');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(validPackageJson()));
    writeFileSync(join(pluginDir, 'dist', 'tools.json'), JSON.stringify({ sdkVersion: '99.0.0', tools: validTools() }));
    writeFileSync(join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})()');

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('SDK');
      expect(result.error).toContain('99.0.0');
      expect(result.error).toContain('Rebuild the plugin');
    }
  });
});

describe('parseMajorMinor', () => {
  test('parses valid semver into [major, minor]', () => {
    expect(parseMajorMinor('1.2.3')).toEqual([1, 2]);
    expect(parseMajorMinor('0.0.16')).toEqual([0, 0]);
    expect(parseMajorMinor('10.20.30')).toEqual([10, 20]);
  });

  test('returns null for invalid version strings', () => {
    expect(parseMajorMinor('not-a-version')).toBeNull();
    expect(parseMajorMinor('')).toBeNull();
    expect(parseMajorMinor('1.2')).toBeNull();
  });

  test('handles semver with pre-release suffix', () => {
    expect(parseMajorMinor('1.2.3-beta.1')).toEqual([1, 2]);
  });
});

describe('loadPlugin — SVG icon extraction', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-loader-icon-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const writePluginWithManifest = (
    dir: string,
    manifest: Record<string, unknown>,
    packageJson: Record<string, unknown> = {
      name: 'opentabs-plugin-test',
      version: '1.0.0',
      main: 'dist/adapter.iife.js',
      opentabs: {
        displayName: 'Test',
        description: 'Test',
        urlPatterns: ['http://localhost/*'],
      },
    },
  ) => {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson));
    writeFileSync(join(dir, 'dist', 'tools.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'dist', 'adapter.iife.js'), '(function(){})()');
  };

  test('extracts iconSvg and iconInactiveSvg from manifest object', async () => {
    const pluginDir = join(tmpDir, 'with-icons');
    writePluginWithManifest(pluginDir, {
      sdkVersion: '0.0.16',
      tools: [
        {
          name: 't',
          displayName: 'T',
          description: 'T',
          icon: 'wrench',
          input_schema: {},
          output_schema: {},
        },
      ],
      iconSvg: '<svg>active</svg>',
      iconInactiveSvg: '<svg>inactive</svg>',
    });

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.iconSvg).toBe('<svg>active</svg>');
    expect(result.value.iconInactiveSvg).toBe('<svg>inactive</svg>');
  });

  test('iconSvg and iconInactiveSvg are undefined when not in manifest', async () => {
    const pluginDir = join(tmpDir, 'no-icons');
    writePluginWithManifest(pluginDir, {
      sdkVersion: '0.0.16',
      tools: [
        {
          name: 't',
          displayName: 'T',
          description: 'T',
          icon: 'wrench',
          input_schema: {},
          output_schema: {},
        },
      ],
    });

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.iconSvg).toBeUndefined();
    expect(result.value.iconInactiveSvg).toBeUndefined();
  });

  test('iconSvg is undefined when manifest has non-string value', async () => {
    const pluginDir = join(tmpDir, 'bad-icon');
    writePluginWithManifest(pluginDir, {
      sdkVersion: '0.0.16',
      tools: [
        {
          name: 't',
          displayName: 'T',
          description: 'T',
          icon: 'wrench',
          input_schema: {},
          output_schema: {},
        },
      ],
      iconSvg: 42,
      iconInactiveSvg: true,
    });

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.iconSvg).toBeUndefined();
    expect(result.value.iconInactiveSvg).toBeUndefined();
  });

  test('icons are undefined for legacy plain-array tools.json format', async () => {
    const pluginDir = join(tmpDir, 'legacy');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'opentabs-plugin-test',
        version: '1.0.0',
        main: 'dist/adapter.iife.js',
        opentabs: {
          displayName: 'Test',
          description: 'Test',
          urlPatterns: ['http://localhost/*'],
        },
      }),
    );
    writeFileSync(
      join(pluginDir, 'dist', 'tools.json'),
      JSON.stringify([
        {
          name: 't',
          displayName: 'T',
          description: 'T',
          icon: 'wrench',
          input_schema: {},
          output_schema: {},
        },
      ]),
    );
    writeFileSync(join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})()');

    const result = await loadPlugin(pluginDir, 'local');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.iconSvg).toBeUndefined();
    expect(result.value.iconInactiveSvg).toBeUndefined();
  });
});

describe('checkSdkCompatibility', () => {
  test('compatible when plugin sdkVersion is undefined', () => {
    const result = checkSdkCompatibility(undefined, '0.0.16');
    expect(result.compatible).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('compatible when plugin major.minor equals server major.minor', () => {
    const result = checkSdkCompatibility('0.0.16', '0.0.16');
    expect(result.compatible).toBe(true);
  });

  test('compatible when plugin major.minor is older than server', () => {
    const result = checkSdkCompatibility('0.0.10', '0.0.16');
    expect(result.compatible).toBe(true);
  });

  test('compatible with different patch versions (same major.minor)', () => {
    const result = checkSdkCompatibility('1.2.3', '1.2.99');
    expect(result.compatible).toBe(true);
  });

  test('incompatible when plugin minor is newer than server', () => {
    const result = checkSdkCompatibility('0.1.0', '0.0.16');
    expect(result.compatible).toBe(false);
    expect(result.error).toContain('SDK 0.1.0');
    expect(result.error).toContain('SDK 0.0.16');
  });

  test('incompatible when plugin major is newer than server', () => {
    const result = checkSdkCompatibility('2.0.0', '1.5.0');
    expect(result.compatible).toBe(false);
    expect(result.error).toContain('SDK 2.0.0');
    expect(result.error).toContain('SDK 1.5.0');
  });

  test('compatible when plugin version is unparseable', () => {
    const result = checkSdkCompatibility('garbage', '0.0.16');
    expect(result.compatible).toBe(true);
  });

  test('compatible when server version is unparseable', () => {
    const result = checkSdkCompatibility('0.0.16', 'garbage');
    expect(result.compatible).toBe(true);
  });
});
