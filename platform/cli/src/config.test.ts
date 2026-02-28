import {
  ensureAuthSecret,
  getLocalPluginsFromConfig,
  isConnectionRefused,
  readConfig,
  resolvePluginPath,
} from './config.js';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Test isolation: override config dir so tests don't touch real config
// ---------------------------------------------------------------------------

const TEST_BASE_DIR = mkdtempSync(join(tmpdir(), 'opentabs-cli-config-test-'));
const originalConfigDir = process.env.OPENTABS_CONFIG_DIR;
process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;

afterAll(() => {
  if (originalConfigDir !== undefined) {
    process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.OPENTABS_CONFIG_DIR;
  }
  rmSync(TEST_BASE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readConfig
// ---------------------------------------------------------------------------

describe('readConfig', () => {
  const configPath = join(TEST_BASE_DIR, 'read-config-test.json');

  afterEach(async () => {
    try {
      await unlink(configPath);
    } catch {
      // File may not exist
    }
  });

  test('returns missing error for nonexistent file', async () => {
    const result = await readConfig(join(TEST_BASE_DIR, 'nonexistent.json'));
    expect(result).toEqual({ config: null, error: 'missing' });
  });

  test('returns config object for valid JSON object', async () => {
    await writeFile(configPath, JSON.stringify({ localPlugins: [], tools: {} }), 'utf-8');
    const result = await readConfig(configPath);
    expect(result.config).toEqual({ localPlugins: [], tools: {} });
    expect(result.error).toBeUndefined();
  });

  test('returns invalid error for JSON array', async () => {
    await writeFile(configPath, JSON.stringify([1, 2, 3]), 'utf-8');
    const result = await readConfig(configPath);
    expect(result.config).toBeNull();
    expect(result.error).toBe('invalid');
    if (result.error === 'invalid') {
      expect(result.message).toContain('array');
    }
  });

  test('returns invalid error for JSON string', async () => {
    await writeFile(configPath, JSON.stringify('hello'), 'utf-8');
    const result = await readConfig(configPath);
    expect(result.config).toBeNull();
    expect(result.error).toBe('invalid');
  });

  test('returns invalid error for JSON number', async () => {
    await writeFile(configPath, JSON.stringify(42), 'utf-8');
    const result = await readConfig(configPath);
    expect(result.config).toBeNull();
    expect(result.error).toBe('invalid');
  });

  test('returns invalid error for JSON null', async () => {
    await writeFile(configPath, 'null', 'utf-8');
    const result = await readConfig(configPath);
    expect(result.config).toBeNull();
    expect(result.error).toBe('invalid');
  });

  test('returns invalid error for invalid JSON', async () => {
    await writeFile(configPath, '{not valid json}', 'utf-8');
    const result = await readConfig(configPath);
    expect(result.config).toBeNull();
    expect(result.error).toBe('invalid');
    if (result.error === 'invalid') {
      expect(result.message).toContain('Invalid JSON');
    }
  });

  test('returns invalid error for truncated JSON', async () => {
    await writeFile(configPath, '{"localPlugins": [', 'utf-8');
    const result = await readConfig(configPath);
    expect(result.config).toBeNull();
    expect(result.error).toBe('invalid');
  });

  test('returns config with extra fields preserved', async () => {
    await writeFile(configPath, JSON.stringify({ localPlugins: [], custom: 'value' }), 'utf-8');
    const result = await readConfig(configPath);
    expect(result.config).toEqual({ localPlugins: [], custom: 'value' });
  });
});

// ---------------------------------------------------------------------------
// getLocalPluginsFromConfig
// ---------------------------------------------------------------------------

describe('getLocalPluginsFromConfig', () => {
  test('returns string array from localPlugins field', () => {
    const config = { localPlugins: ['/path/a', '/path/b'] };
    expect(getLocalPluginsFromConfig(config)).toEqual(['/path/a', '/path/b']);
  });

  test('filters non-string elements from mixed array', () => {
    const config = { localPlugins: ['/valid', 123, null, true, '/also-valid', undefined] };
    expect(getLocalPluginsFromConfig(config)).toEqual(['/valid', '/also-valid']);
  });

  test('returns empty array when localPlugins key is missing', () => {
    const config = { tools: {} };
    expect(getLocalPluginsFromConfig(config)).toEqual([]);
  });

  test('returns empty array when localPlugins is not an array', () => {
    expect(getLocalPluginsFromConfig({ localPlugins: 'not-an-array' })).toEqual([]);
    expect(getLocalPluginsFromConfig({ localPlugins: 42 })).toEqual([]);
    expect(getLocalPluginsFromConfig({ localPlugins: null })).toEqual([]);
    expect(getLocalPluginsFromConfig({ localPlugins: {} })).toEqual([]);
  });

  test('returns empty array for empty localPlugins array', () => {
    expect(getLocalPluginsFromConfig({ localPlugins: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolvePluginPath
// ---------------------------------------------------------------------------

describe('resolvePluginPath', () => {
  test('returns absolute path as-is', () => {
    const result = resolvePluginPath('/home/user/my-plugin', '/home/user/.opentabs/config.json');
    expect(result).toBe('/home/user/my-plugin');
  });

  test('resolves relative path against config directory', () => {
    const result = resolvePluginPath('../my-plugin', '/home/user/.opentabs/config.json');
    expect(result).toBe('/home/user/my-plugin');
  });

  test('resolves dot-slash relative path against config directory', () => {
    const result = resolvePluginPath('./plugins/my-plugin', '/home/user/.opentabs/config.json');
    expect(result).toBe('/home/user/.opentabs/plugins/my-plugin');
  });

  test('resolves bare name relative path against config directory', () => {
    const result = resolvePluginPath('my-plugin', '/home/user/.opentabs/config.json');
    expect(result).toBe('/home/user/.opentabs/my-plugin');
  });

  test('expands tilde prefix to home directory', () => {
    const result = resolvePluginPath('~/projects/my-plugin', '/home/user/.opentabs/config.json');
    expect(result).toBe(resolve(homedir(), 'projects/my-plugin'));
  });
});

// ---------------------------------------------------------------------------
// isConnectionRefused
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ensureAuthSecret
// ---------------------------------------------------------------------------

describe('ensureAuthSecret', () => {
  const extensionDir = join(TEST_BASE_DIR, 'extension');
  const authPath = join(extensionDir, 'auth.json');

  afterEach(async () => {
    try {
      await unlink(authPath);
    } catch {
      // File may not exist
    }
  });

  test('generates and writes a new secret when auth.json does not exist', async () => {
    const secret = await ensureAuthSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBe(64);
    // Verify auth.json was written
    const content: unknown = JSON.parse(await readFile(authPath, 'utf-8'));
    expect(content).toEqual({ secret });
  });

  test('returns the same secret on repeated calls', async () => {
    const first = await ensureAuthSecret();
    const second = await ensureAuthSecret();
    expect(first).toBe(second);
  });

  test('returns existing secret without overwriting it', async () => {
    const existingSecret = 'a'.repeat(64);
    await mkdir(extensionDir, { recursive: true });
    await writeFile(authPath, JSON.stringify({ secret: existingSecret }) + '\n', 'utf-8');

    const result = await ensureAuthSecret();
    expect(result).toBe(existingSecret);
  });

  test('regenerates secret when auth.json contains malformed JSON', async () => {
    await mkdir(extensionDir, { recursive: true });
    await writeFile(authPath, '{not valid json}', 'utf-8');

    const secret = await ensureAuthSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBe(64);
    // New secret was written over the malformed file
    const content: unknown = JSON.parse(await readFile(authPath, 'utf-8'));
    expect(content).toEqual({ secret });
  });

  test('regenerates secret when auth.json has no secret field', async () => {
    await mkdir(extensionDir, { recursive: true });
    await writeFile(authPath, JSON.stringify({ other: 'value' }) + '\n', 'utf-8');

    const secret = await ensureAuthSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBe(64);
  });
});

describe('isConnectionRefused', () => {
  test('returns true for TypeError with cause.code ECONNREFUSED', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    expect(isConnectionRefused(err)).toBe(true);
  });

  test('returns false for TypeError without cause', () => {
    const err = new TypeError('fetch failed');
    expect(isConnectionRefused(err)).toBe(false);
  });

  test('returns false for TypeError with cause but different code', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    expect(isConnectionRefused(err)).toBe(false);
  });

  test('returns false for non-TypeError Error', () => {
    const err = new Error('connection refused');
    expect(isConnectionRefused(err)).toBe(false);
  });

  test('returns false for plain string', () => {
    expect(isConnectionRefused('ECONNREFUSED')).toBe(false);
  });

  test('returns false for null', () => {
    expect(isConnectionRefused(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isConnectionRefused(undefined)).toBe(false);
  });
});
