/**
 * Config migration E2E tests — verify that the MCP server migrates legacy
 * config.json files on startup and that migrated settings resolve correctly.
 *
 * Key scenarios:
 *   1. Legacy v1 config (no version field, string instanceUrl) → migrated on startup
 *   2. Current version config → no backup created, config unchanged
 *   3. Backup file created during migration
 *   4. Mixed url settings migrate correctly
 *   5. MCP tools work after migration
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpClient, McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  E2E_TEST_PLUGIN_DIR,
  expect,
  readPluginToolNames,
  startMcpServer,
  test,
} from './fixtures.js';

/**
 * Write a raw config.json to a config directory.
 * Unlike writeTestConfig, this writes the exact JSON provided — no auto-generated
 * permissions or version fields. Used for v1 migration tests where we need full
 * control over the raw config shape.
 */
function writeRawConfig(configDir: string, raw: Record<string, unknown>): void {
  fs.writeFileSync(path.join(configDir, 'config.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
}

/** Read config.json from disk and parse as raw JSON. */
function readRawConfig(configDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
}

/** Create an isolated config directory with auth.json pre-populated. */
function createConfigDir(prefix: string): string {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), `opentabs-e2e-migration-${prefix}-`));
  // Create extension dir with auth.json — the server reads the secret from here
  const extensionDir = path.join(configDir, 'extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  const secret = crypto.randomUUID();
  fs.writeFileSync(path.join(extensionDir, 'auth.json'), `${JSON.stringify({ secret })}\n`, 'utf-8');
  return configDir;
}

// ---------------------------------------------------------------------------
// Legacy v1 config migrates on server start
// ---------------------------------------------------------------------------

test.describe('Config migration — v1 to v2', () => {
  test('legacy v1 config with string instanceUrl is migrated on server start', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      configDir = createConfigDir('v1-migrate');
      // Write a v1 config: no version field, instanceUrl as a plain string
      writeRawConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {
          'e2e-test': { instanceUrl: 'http://localhost:9999' },
        },
      });

      server = await startMcpServer(configDir, true);
      // Wait for the server to finish loading plugins
      await server.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

      // Read config.json from disk — it should have been migrated
      const migratedConfig = readRawConfig(configDir);

      // Version should be updated to current (3)
      expect(migratedConfig.version).toBe(3);

      // instanceUrl should be converted from string to Record
      const settings = migratedConfig.settings as Record<string, Record<string, unknown>>;
      expect(settings['e2e-test']?.instanceUrl).toEqual({ default: 'http://localhost:9999' });
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('v1 config with no version field gets version field after startup', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      configDir = createConfigDir('v1-no-version');
      // Write a config without a version field at all
      writeRawConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {},
      });

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

      // Config should now have a version field
      const migratedConfig = readRawConfig(configDir);
      expect(migratedConfig.version).toBe(3);
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Current version config is not modified
// ---------------------------------------------------------------------------

test.describe('Config migration — current version', () => {
  test('current version config is not modified and no backup is created', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      configDir = createConfigDir('v3-noop');
      // Write a v3 config with instanceUrl already in Record format
      const originalConfig = {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {
          'e2e-test': { instanceUrl: { default: 'http://localhost:9999' } },
        },
        version: 3,
      };
      writeRawConfig(configDir, originalConfig);

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

      // No backup should be created for current-version configs
      const backupPath = path.join(configDir, 'config.json.backup');
      expect(fs.existsSync(backupPath)).toBe(false);

      // Config should be unchanged
      const configAfter = readRawConfig(configDir);
      expect(configAfter.version).toBe(3);
      const settings = configAfter.settings as Record<string, Record<string, unknown>>;
      expect(settings['e2e-test']?.instanceUrl).toEqual({ default: 'http://localhost:9999' });
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Backup created during migration
// ---------------------------------------------------------------------------

test.describe('Config migration — backup', () => {
  test('backup file is created when migration runs', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      configDir = createConfigDir('backup');
      // Write a v1 config that will trigger migration
      const originalConfig = {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {
          'e2e-test': { instanceUrl: 'https://example.com' },
        },
      };
      writeRawConfig(configDir, originalConfig);
      const originalContent = fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8');

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

      // Backup should exist with the original content
      const backupPath = path.join(configDir, 'config.json.backup');
      expect(fs.existsSync(backupPath)).toBe(true);
      const backupContent = fs.readFileSync(backupPath, 'utf-8');
      expect(backupContent).toBe(originalContent);
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Mixed url settings migrate correctly
// ---------------------------------------------------------------------------

test.describe('Config migration — mixed settings', () => {
  test('config with mixed string and Record url settings migrates correctly', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      configDir = createConfigDir('mixed');
      // Write a v1 config with mixed settings:
      // - instanceUrl as a plain string (needs migration)
      // - testString as a plain non-URL string (should not be migrated)
      writeRawConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {
          'e2e-test': {
            instanceUrl: 'https://my-instance.example.com',
            testString: 'some-non-url-value',
          },
        },
      });

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

      const migratedConfig = readRawConfig(configDir);
      expect(migratedConfig.version).toBe(3);

      const settings = migratedConfig.settings as Record<string, Record<string, unknown>>;
      // URL string should be wrapped in { default: ... }
      expect(settings['e2e-test']?.instanceUrl).toEqual({ default: 'https://my-instance.example.com' });
      // Non-URL string should be preserved as-is
      expect(settings['e2e-test']?.testString).toBe('some-non-url-value');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// MCP tools work after migration
// ---------------------------------------------------------------------------

test.describe('Config migration — tools after migration', () => {
  test('MCP tools are available after v1 config migration', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();

      configDir = createConfigDir('tools-after');
      // Write a v1 config with the e2e-test plugin and string instanceUrl
      writeRawConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {
          'e2e-test': { instanceUrl: 'http://localhost:9999' },
        },
      });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for the server to have plugins loaded
      await server.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

      // List tools — all e2e-test tools should be present
      const tools = await client.listTools();
      const e2eTools = tools.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eTools.length).toBe(prefixedToolNames.length);

      // Verify specific known tools are present
      expect(tools.map(t => t.name)).toContain('e2e-test_echo');
      expect(tools.map(t => t.name)).toContain('e2e-test_get_status');
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});
