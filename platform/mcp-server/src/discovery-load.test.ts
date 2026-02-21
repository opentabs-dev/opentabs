import { loadPluginFromDir } from './discovery-legacy.js';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Unit tests for loadPluginFromDir.
 *
 * Uses real temp directories with real files (same pattern as reload.test.ts)
 * to exercise manifest validation, IIFE reading, and name derivation.
 */

/** Minimal valid manifest fields */
const validManifest = (overrides: Record<string, unknown> = {}) => ({
  name: 'test-plugin',
  version: '1.0.0',
  displayName: 'Test Plugin',
  description: 'A test plugin',
  url_patterns: ['http://localhost/*'],
  tools: [
    {
      name: 'my_tool',
      displayName: 'My Tool',
      description: 'A tool',
      icon: 'wrench',
      input_schema: {},
      output_schema: {},
    },
  ],
  ...overrides,
});

describe('loadPluginFromDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-discovery-load-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a manifest and IIFE to a plugin directory */
  const writePlugin = (
    dir: string,
    manifest: Record<string, unknown>,
    iifeContent = '(function(){window.__test=true})()',
  ) => {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'opentabs-plugin.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'dist', 'adapter.iife.js'), iifeContent);
  };

  test('loads a valid plugin with all fields populated', async () => {
    const pluginDir = join(tmpDir, 'my-plugin');
    const manifest = validManifest({ displayName: 'My Plugin', adapterHash: 'abc123' });
    writePlugin(pluginDir, manifest);

    const result = await loadPluginFromDir(pluginDir, 'local', null, pluginDir);

    expect(result.name).toBe('test-plugin');
    expect(result.version).toBe('1.0.0');
    expect(result.displayName).toBe('My Plugin');
    expect(result.urlPatterns).toEqual(['http://localhost/*']);
    expect(result.trustTier).toBe('local');
    expect(result.iife).toBe('(function(){window.__test=true})()');
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.name).toBe('my_tool');
    expect(result.adapterHash).toBe('abc123');
    expect(result.sourcePath).toBe(pluginDir);
    expect(result.npmPackageName).toBeUndefined();
  });

  test('throws when IIFE file is missing', () => {
    const pluginDir = join(tmpDir, 'no-iife');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'opentabs-plugin.json'), JSON.stringify(validManifest()));

    expect(async () => await loadPluginFromDir(pluginDir, 'local', null)).toThrow(/not found/);
  });

  test('throws when IIFE file is empty', () => {
    const pluginDir = join(tmpDir, 'empty-iife');
    writePlugin(pluginDir, validManifest(), '');

    expect(async () => await loadPluginFromDir(pluginDir, 'local', null)).toThrow(/empty/);
  });

  test('throws when plugin name in manifest is invalid', () => {
    const pluginDir = join(tmpDir, 'bad-name');
    writePlugin(pluginDir, validManifest({ name: 'INVALID NAME!' }));

    expect(async () => await loadPluginFromDir(pluginDir, 'local', null)).toThrow(/must be lowercase/);
  });

  test('throws when IIFE file exceeds 5MB size limit', () => {
    const pluginDir = join(tmpDir, 'oversized-iife');
    const oversizedContent = 'x'.repeat(5 * 1024 * 1024 + 1);
    writePlugin(pluginDir, validManifest(), oversizedContent);

    expect(async () => await loadPluginFromDir(pluginDir, 'local', null)).toThrow(/exceeding the 5MB limit/);
  });

  test('local plugin (npmPkgName=null) derives name from manifest.name', async () => {
    const pluginDir = join(tmpDir, 'local-derive');
    writePlugin(pluginDir, validManifest({ name: 'my-local-tool' }));

    const result = await loadPluginFromDir(pluginDir, 'local', null);
    expect(result.name).toBe('my-local-tool');
    expect(result.npmPackageName).toBeUndefined();
  });

  test('local plugin strips legacy opentabs-plugin- prefix from manifest name', async () => {
    const pluginDir = join(tmpDir, 'legacy-prefix');
    writePlugin(pluginDir, validManifest({ name: 'opentabs-plugin-legacy' }));

    const result = await loadPluginFromDir(pluginDir, 'local', null);
    expect(result.name).toBe('legacy');
  });

  test('npm plugin derives name from package name via pluginNameFromPackage', async () => {
    const pluginDir = join(tmpDir, 'npm-derive');
    writePlugin(pluginDir, validManifest({ name: 'slack' }));

    const result = await loadPluginFromDir(pluginDir, 'community', 'opentabs-plugin-slack');
    expect(result.name).toBe('slack');
    expect(result.npmPackageName).toBe('opentabs-plugin-slack');
  });

  test('manifest name mismatch with npm package name does not throw', async () => {
    const pluginDir = join(tmpDir, 'mismatch');
    writePlugin(pluginDir, validManifest({ name: 'different-name' }));

    // Should not throw — mismatch produces a warning but loads successfully
    const result = await loadPluginFromDir(pluginDir, 'community', 'opentabs-plugin-slack');
    // The name comes from the npm package name, not the manifest
    expect(result.name).toBe('slack');
    expect(result.npmPackageName).toBe('opentabs-plugin-slack');
  });
});
