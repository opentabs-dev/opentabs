import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { chmod, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OpentabsConfig } from './config.js';
import {
  KNOWN_CONFIG_KEYS,
  levenshtein,
  loadConfig,
  saveConfig,
  savePluginPermissions,
  savePluginSettings,
  writeAuthFile,
} from './config.js';
import { log } from './logger.js';

// Override OPENTABS_CONFIG_DIR for test isolation.
// Config functions read this env var lazily on each call.
const TEST_BASE_DIR = mkdtempSync(join(tmpdir(), 'opentabs-config-test-'));
const originalConfigDir = process.env.OPENTABS_CONFIG_DIR;
process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;

const configPath = join(TEST_BASE_DIR, 'config.json');

/** Test wrapper that provides a mock state object with configWriteMutex */
const mockState = { configWriteMutex: Promise.resolve() };
const saveConfigWrapped = (config: OpentabsConfig) => saveConfig(mockState, config);

const removeConfig = async () => {
  try {
    await unlink(configPath);
  } catch {
    // File may not exist
  }
};

describe('loadConfig / saveConfig round-trip', () => {
  beforeEach(async () => {
    await removeConfig();
  });

  afterAll(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
    rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  });

  test('creates default config on first load', async () => {
    expect(existsSync(configPath)).toBe(false);

    const config = await loadConfig();

    expect(config.localPlugins).toEqual([]);
    expect(config.permissions).toEqual({});
    expect(config.version).toBe(3);

    // File was created on disk
    expect(existsSync(configPath)).toBe(true);
  });

  test('creates default config with empty settings', async () => {
    const config = await loadConfig();
    expect(config.settings).toEqual({});
  });

  test('round-trips through save and load including settings', async () => {
    await loadConfig();

    const custom: OpentabsConfig = {
      localPlugins: ['/path/to/plugin-a', '/path/to/plugin-b'],
      permissions: {
        slack: { permission: 'auto', tools: { send_message: 'ask' } },
        discord: { permission: 'off' },
      },
      settings: {
        sqlpad: { instanceUrl: 'https://sqlpad.example.com' },
      },
      version: 3,
    };
    await saveConfigWrapped(custom);

    const loaded = await loadConfig();
    expect(loaded.localPlugins).toEqual(custom.localPlugins);
    expect(loaded.permissions).toEqual(custom.permissions);
    expect(loaded.settings).toEqual(custom.settings);
    expect(loaded.version).toBe(custom.version);
  });

  test('filters non-string elements from localPlugins array', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        localPlugins: ['/valid/path', 123, null, true, '/another/path'],
        permissions: {},
      }),
    );

    const config = await loadConfig();
    expect(config.localPlugins).toEqual(['/valid/path', '/another/path']);
  });

  test('parses valid plugin permission entries and ignores invalid ones', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        localPlugins: [],
        permissions: {
          slack: { permission: 'auto', tools: { send_message: 'ask' } },
          invalid_perm: { permission: 'bogus' },
          invalid_tool_perm: { tools: { foo: 'bogus' } },
          valid_tools_only: { tools: { bar: 'off' } },
          empty_obj: {},
          not_an_object: 'string',
        },
      }),
    );

    const config = await loadConfig();
    expect(config.permissions).toEqual({
      slack: { permission: 'auto', tools: { send_message: 'ask' } },
      valid_tools_only: { tools: { bar: 'off' } },
    });
  });

  test('ignores absent permissions field without error', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        localPlugins: ['/some/plugin'],
      }),
    );

    const config = await loadConfig();
    expect(config.localPlugins).toEqual(['/some/plugin']);
    expect(config.permissions).toEqual({});
    expect(config.version).toBe(3);
  });

  test('default config has empty permissions map', async () => {
    const config = await loadConfig();
    expect(config.permissions).toEqual({});
  });

  test('parses settings field with nested plugin objects', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        localPlugins: [],
        permissions: {},
        settings: {
          sqlpad: { instanceUrl: 'https://sqlpad.example.com', port: 3000 },
          jira: { baseUrl: 'https://jira.company.com' },
        },
      }),
    );

    const config = await loadConfig();
    expect(config.settings).toEqual({
      sqlpad: { instanceUrl: { default: 'https://sqlpad.example.com' }, port: 3000 },
      jira: { baseUrl: { default: 'https://jira.company.com' } },
    });
  });

  test('ignores non-object entries in settings map', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        localPlugins: [],
        permissions: {},
        settings: {
          valid: { key: 'value' },
          invalid_string: 'not-an-object',
          invalid_array: [1, 2],
          invalid_null: null,
        },
      }),
    );

    const config = await loadConfig();
    expect(config.settings).toEqual({
      valid: { key: 'value' },
    });
  });

  test('returns empty settings when settings field is absent', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        localPlugins: [],
        permissions: {},
      }),
    );

    const config = await loadConfig();
    expect(config.settings).toEqual({});
  });
});

describe('savePluginPermissions round-trip', () => {
  beforeEach(async () => {
    process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;
    await removeConfig();
  });

  test('persists plugin permissions without overwriting localPlugins', async () => {
    // Create initial config with localPlugins
    const initial: OpentabsConfig = {
      localPlugins: ['/my/plugin'],
      permissions: {},
      settings: {},
      version: 3,
    };
    await saveConfigWrapped(initial);

    // Save new plugin permissions via the read-modify-write function
    const state = { configWriteMutex: Promise.resolve() };
    await savePluginPermissions(state, {
      slack: { permission: 'auto' },
      discord: { permission: 'ask', tools: { send_message: 'auto' } },
    });

    // Verify localPlugins are preserved and permissions are updated
    const loaded = await loadConfig();
    expect(loaded.localPlugins).toEqual(['/my/plugin']);
    expect(loaded.permissions).toEqual({
      slack: { permission: 'auto' },
      discord: { permission: 'ask', tools: { send_message: 'auto' } },
    });
  });

  test('overwrites previous plugin permissions completely', async () => {
    const initial: OpentabsConfig = {
      localPlugins: [],
      permissions: { slack: { permission: 'auto' } },
      settings: {},
      version: 3,
    };
    await saveConfigWrapped(initial);

    const state = { configWriteMutex: Promise.resolve() };
    await savePluginPermissions(state, {
      discord: { permission: 'off' },
    });

    const loaded = await loadConfig();
    // Previous slack entry is gone — replaced by new permissions map
    expect(loaded.permissions).toEqual({
      discord: { permission: 'off' },
    });
  });

  test('preserves settings when saving plugin permissions', async () => {
    const initial: OpentabsConfig = {
      localPlugins: [],
      permissions: {},
      settings: {
        sqlpad: { instanceUrl: 'https://sqlpad.example.com' },
      },
      version: 3,
    };
    await saveConfigWrapped(initial);

    const state = { configWriteMutex: Promise.resolve() };
    await savePluginPermissions(state, { slack: { permission: 'auto' } });

    const loaded = await loadConfig();
    expect(loaded.settings).toEqual({
      sqlpad: { instanceUrl: 'https://sqlpad.example.com' },
    });
    expect(loaded.permissions).toEqual({ slack: { permission: 'auto' } });
  });
});

describe('savePluginSettings round-trip', () => {
  beforeEach(async () => {
    process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;
    await removeConfig();
  });

  test('persists plugin settings without overwriting localPlugins or permissions', async () => {
    const initial: OpentabsConfig = {
      localPlugins: ['/my/plugin'],
      permissions: { slack: { permission: 'auto' } },
      settings: {},
      version: 3,
    };
    await saveConfigWrapped(initial);

    const state = { configWriteMutex: Promise.resolve() };
    await savePluginSettings(state, {
      sqlpad: { instanceUrl: 'https://sqlpad.example.com' },
    });

    const loaded = await loadConfig();
    expect(loaded.localPlugins).toEqual(['/my/plugin']);
    expect(loaded.permissions).toEqual({ slack: { permission: 'auto' } });
    expect(loaded.settings).toEqual({
      sqlpad: { instanceUrl: 'https://sqlpad.example.com' },
    });
  });

  test('overwrites previous settings completely', async () => {
    const initial: OpentabsConfig = {
      localPlugins: [],
      permissions: {},
      settings: { old_plugin: { key: 'old-value' } },
      version: 3,
    };
    await saveConfigWrapped(initial);

    const state = { configWriteMutex: Promise.resolve() };
    await savePluginSettings(state, {
      new_plugin: { url: 'https://new.example.com' },
    });

    const loaded = await loadConfig();
    expect(loaded.settings).toEqual({
      new_plugin: { url: 'https://new.example.com' },
    });
  });
});

describe('saveConfig error propagation', () => {
  // Root bypasses POSIX file permissions, so chmod-based write-failure
  // simulation does not work when running as root (e.g., Docker containers).
  const isRoot = process.getuid?.() === 0;

  // Windows NTFS does not support Unix file permissions, so chmod cannot
  // simulate write failures.
  const isWindows = process.platform === 'win32';
  const skipChmod = isRoot || isWindows;

  beforeEach(async () => {
    process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;
    await removeConfig();
  });

  test.skipIf(skipChmod)('saveConfig propagates write errors to the caller', async () => {
    await loadConfig();
    // Make the directory non-writable so atomicWrite cannot create temp files
    await chmod(TEST_BASE_DIR, 0o555);

    const state = { configWriteMutex: Promise.resolve() };
    const config: OpentabsConfig = {
      localPlugins: [],
      permissions: {},
      settings: {},
      version: 3,
    };

    await expect(saveConfig(state, config)).rejects.toThrow();

    // Restore permissions for cleanup
    await chmod(TEST_BASE_DIR, 0o700);
  });

  test.skipIf(skipChmod)('saveConfig mutex does not deadlock after a failed write', async () => {
    await loadConfig();
    await chmod(TEST_BASE_DIR, 0o555);

    const state = { configWriteMutex: Promise.resolve() };
    const config: OpentabsConfig = {
      localPlugins: ['/test/path'],
      permissions: {},
      settings: {},
      version: 3,
    };

    // First write fails
    await expect(saveConfig(state, config)).rejects.toThrow();

    // Restore permissions
    await chmod(TEST_BASE_DIR, 0o700);

    // Subsequent write succeeds — the mutex is not deadlocked
    await saveConfig(state, config);

    const loaded = await loadConfig();
    expect(loaded.localPlugins).toEqual(['/test/path']);
  });

  test.skipIf(skipChmod)('savePluginPermissions propagates write errors to the caller', async () => {
    await loadConfig();
    await chmod(TEST_BASE_DIR, 0o555);

    const state = { configWriteMutex: Promise.resolve() };

    await expect(savePluginPermissions(state, { slack: { permission: 'off' } })).rejects.toThrow();

    // Restore permissions for cleanup
    await chmod(TEST_BASE_DIR, 0o700);
  });

  test.skipIf(skipChmod)('savePluginPermissions mutex does not deadlock after a failed write', async () => {
    await loadConfig();
    await chmod(TEST_BASE_DIR, 0o555);

    const state = { configWriteMutex: Promise.resolve() };

    // First write fails
    await expect(savePluginPermissions(state, { slack: { permission: 'off' } })).rejects.toThrow();

    // Restore permissions
    await chmod(TEST_BASE_DIR, 0o700);

    // Subsequent write succeeds — the mutex is not deadlocked
    await savePluginPermissions(state, { discord: { permission: 'auto' } });

    const loaded = await loadConfig();
    expect(loaded.permissions).toEqual({ discord: { permission: 'auto' } });
  });
});

describe('writeAuthFile', () => {
  const authPath = join(TEST_BASE_DIR, 'extension', 'auth.json');

  beforeEach(() => {
    // Re-assert the env var before each test since other test files running
    // concurrently in the same vitest process may have modified it.
    process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;
  });

  test('writes auth.json with secret only (no port)', async () => {
    await writeAuthFile('test-secret-abc');

    expect(existsSync(authPath)).toBe(true);
    const content = JSON.parse(await readFile(authPath, 'utf-8')) as Record<string, unknown>;
    expect(content.secret).toBe('test-secret-abc');
    expect(content).not.toHaveProperty('port');
  });

  // Windows NTFS does not support Unix file permissions; mode always reads as 0o666.
  test.skipIf(process.platform === 'win32')('writes auth.json with restrictive permissions (0600)', async () => {
    await writeAuthFile('perm-test-secret');

    const stats = statSync(authPath);
    // 0o600 = owner read/write only (octal 33188 = 0o100600 including file type bits)
    expect(stats.mode & 0o777).toBe(0o600);
  });

  test('overwrites existing auth.json on subsequent calls', async () => {
    await writeAuthFile('first-secret');
    await writeAuthFile('second-secret');

    const content = JSON.parse(await readFile(authPath, 'utf-8')) as Record<string, unknown>;
    expect(content.secret).toBe('second-secret');
  });
});

describe('levenshtein', () => {
  test('returns 0 for identical strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  test('returns length of the other string when one is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('hello', '')).toBe(5);
  });

  test('returns 0 for two empty strings', () => {
    expect(levenshtein('', '')).toBe(0);
  });

  test('computes single-character edits', () => {
    expect(levenshtein('cat', 'bat')).toBe(1); // substitution
    expect(levenshtein('cat', 'cats')).toBe(1); // insertion
    expect(levenshtein('cats', 'cat')).toBe(1); // deletion
  });

  test('computes multi-character edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('saturday', 'sunday')).toBe(3);
  });

  test('handles close config key typos', () => {
    expect(levenshtein('localPlugin', 'localPlugins')).toBe(1);
    expect(levenshtein('permisions', 'permissions')).toBe(1);
    expect(levenshtein('setings', 'settings')).toBe(1);
  });
});

describe('KNOWN_CONFIG_KEYS', () => {
  test('contains all OpentabsConfig fields', () => {
    expect(KNOWN_CONFIG_KEYS).toContain('version');
    expect(KNOWN_CONFIG_KEYS).toContain('localPlugins');
    expect(KNOWN_CONFIG_KEYS).toContain('localPluginDirs');
    expect(KNOWN_CONFIG_KEYS).toContain('permissions');
    expect(KNOWN_CONFIG_KEYS).toContain('settings');
    expect(KNOWN_CONFIG_KEYS).toContain('additionalAllowedDirectories');
    expect(KNOWN_CONFIG_KEYS.size).toBe(6);
  });
});

describe('unknown config key warnings', () => {
  beforeEach(async () => {
    process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;
    await removeConfig();
  });

  test('warns about unknown top-level config keys', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      await writeFile(
        configPath,
        JSON.stringify({
          localPlugins: [],
          permissions: {},
          settings: {},
          version: 3,
          unknownField: true,
        }),
      );

      await loadConfig();

      const unknownKeyWarning = warnSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('Unknown config key "unknownField"'),
      );
      expect(unknownKeyWarning).toBeDefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('suggests close matches with did-you-mean', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      await writeFile(
        configPath,
        JSON.stringify({
          localPlugin: [],
          permissions: {},
          version: 3,
        }),
      );

      await loadConfig();

      const suggestion = warnSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes("did you mean 'localPlugins'"),
      );
      expect(suggestion).toBeDefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('does not suggest when distance exceeds threshold', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      await writeFile(
        configPath,
        JSON.stringify({
          localPlugins: [],
          permissions: {},
          version: 3,
          zzzzzzzzz: 'far from any known key',
        }),
      );

      await loadConfig();

      const warning = warnSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('Unknown config key "zzzzzzzzz"'),
      );
      expect(warning).toBeDefined();
      expect(warning![0]).not.toContain('did you mean');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('does not warn about known keys', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      await writeFile(
        configPath,
        JSON.stringify({
          localPlugins: [],
          localPluginDirs: [],
          permissions: {},
          settings: {},
          additionalAllowedDirectories: [],
          version: 3,
        }),
      );

      await loadConfig();

      const unknownKeyWarning = warnSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('Unknown config key'),
      );
      expect(unknownKeyWarning).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('server still loads config successfully despite unknown keys', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      await writeFile(
        configPath,
        JSON.stringify({
          localPlugins: ['/some/plugin'],
          permissions: { slack: { permission: 'auto' } },
          settings: {},
          version: 3,
          extraField: 'ignored',
          anotherExtra: 42,
        }),
      );

      const config = await loadConfig();
      expect(config.localPlugins).toEqual(['/some/plugin']);
      expect(config.permissions).toEqual({ slack: { permission: 'auto' } });
    } finally {
      warnSpy.mockRestore();
    }
  });
});
