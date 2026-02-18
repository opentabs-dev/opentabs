import { loadConfig, saveConfig } from './config.js';
import { isToolEnabled } from './state.js';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpentabsConfig } from './config.js';
import type { ServerState } from './state.js';

// Override OPENTABS_CONFIG_DIR for test isolation.
// Config functions read this env var lazily on each call.
const TEST_BASE_DIR = mkdtempSync(join(tmpdir(), 'opentabs-config-test-'));
const originalConfigDir = Bun.env.OPENTABS_CONFIG_DIR;
Bun.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;

const configPath = join(TEST_BASE_DIR, 'config.json');

/** Test wrapper that provides a mock state object with configWriteMutex */
const mockState = { configWriteMutex: Promise.resolve() };
const saveConfigWrapped = (config: OpentabsConfig) => saveConfig(mockState, config);

const removeConfig = async () => {
  try {
    await Bun.file(configPath).delete();
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
      Bun.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete Bun.env.OPENTABS_CONFIG_DIR;
    }
    rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  });

  test('creates default config on first load', async () => {
    expect(await Bun.file(configPath).exists()).toBe(false);

    const config = await loadConfig();

    expect(config.plugins).toEqual([]);
    expect(config.tools).toEqual({});
    expect(typeof config.secret).toBe('string');
    expect(config.secret).toBeDefined();

    // File was created on disk
    expect(await Bun.file(configPath).exists()).toBe(true);
  });

  test('round-trips through save and load', async () => {
    await loadConfig();

    const custom: OpentabsConfig = {
      plugins: ['/path/to/plugin-a', '/path/to/plugin-b'],
      tools: { slack_send_message: false, slack_read_messages: true },
      secret: 'test-secret-123',
    };
    await saveConfigWrapped(custom);

    const loaded = await loadConfig();
    expect(loaded.plugins).toEqual(custom.plugins);
    expect(loaded.tools).toEqual(custom.tools);
    expect(loaded.secret).toBe('test-secret-123');
  });

  test('filters non-string elements from plugins array', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        plugins: ['/valid/path', 123, null, true, '/another/path'],
        tools: {},
        secret: 'test-secret',
      }),
    );

    const config = await loadConfig();
    expect(config.plugins).toEqual(['/valid/path', '/another/path']);
  });

  test('filters non-boolean values from tools object', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        plugins: [],
        tools: { valid_tool: false, bad_tool: 'yes', another_valid: true, numeric: 1 },
        secret: 'test-secret',
      }),
    );

    const config = await loadConfig();
    expect(config.tools).toEqual({ valid_tool: false, another_valid: true });
  });

  test('generates secret if missing from existing config', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        plugins: [],
        tools: {},
      }),
    );

    const config = await loadConfig();
    expect(typeof config.secret).toBe('string');
    expect(config.secret).toBeDefined();
  });

  test('round-trips npmPlugins through save and load', async () => {
    await loadConfig();

    const custom: OpentabsConfig = {
      plugins: [],
      tools: {},
      secret: 'test-secret-npm',
      npmPlugins: ['opentabs-plugin-jira', '@myorg/opentabs-plugin-github'],
    };
    await saveConfigWrapped(custom);

    const loaded = await loadConfig();
    expect(loaded.npmPlugins).toEqual(['opentabs-plugin-jira', '@myorg/opentabs-plugin-github']);
  });

  test('filters non-string elements from npmPlugins array', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        plugins: [],
        tools: {},
        secret: 'test-secret',
        npmPlugins: ['valid-plugin', 123, null, true, 'another-plugin'],
      }),
    );

    const config = await loadConfig();
    expect(config.npmPlugins).toEqual(['valid-plugin', 'another-plugin']);
  });

  test('returns undefined npmPlugins when field is absent', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        plugins: [],
        tools: {},
        secret: 'test-secret',
      }),
    );

    const config = await loadConfig();
    expect(config.npmPlugins).toBeUndefined();
  });

  test('default config includes empty npmPlugins array', async () => {
    const config = await loadConfig();
    expect(config.npmPlugins).toEqual([]);
  });
});

describe('tool config round-trip with isToolEnabled', () => {
  beforeEach(async () => {
    await removeConfig();
  });

  test('disabled tools survive save → load cycle and isToolEnabled returns false', async () => {
    await loadConfig();

    const config: OpentabsConfig = {
      plugins: [],
      tools: { slack_send: false, slack_read: true },
      secret: 'test-secret-roundtrip',
    };
    await saveConfigWrapped(config);

    const loaded = await loadConfig();
    expect(loaded.tools['slack_send']).toBe(false);
    expect(loaded.tools['slack_read']).toBe(true);

    // Verify isToolEnabled integration with loaded config
    const stateWithConfig = { toolConfig: loaded.tools } as ServerState;
    expect(isToolEnabled(stateWithConfig, 'slack_send')).toBe(false);
    expect(isToolEnabled(stateWithConfig, 'slack_read')).toBe(true);
  });

  test('absent tools default to enabled via isToolEnabled', async () => {
    await loadConfig();

    const config: OpentabsConfig = {
      plugins: [],
      tools: { slack_send: false },
      secret: 'test-secret-absent',
    };
    await saveConfigWrapped(config);

    const loaded = await loadConfig();
    const stateWithConfig = { toolConfig: loaded.tools } as ServerState;

    // Tool not in config → isToolEnabled returns true (enabled by default)
    expect(isToolEnabled(stateWithConfig, 'unknown_tool')).toBe(true);
    // Disabled tool → isToolEnabled returns false
    expect(isToolEnabled(stateWithConfig, 'slack_send')).toBe(false);
  });
});
