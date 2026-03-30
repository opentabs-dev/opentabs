/**
 * E2E tests for localPluginDirs discovery — verify that the MCP server
 * auto-scans parent directories for plugin subdirectories, handles
 * deduplication with localPlugins entries, and gracefully skips
 * non-existent or empty directories.
 *
 * All tests use isolated config directories and dynamic ports for parallel
 * execution safety.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMinimalPlugin,
  E2E_TEST_PLUGIN_DIR,
  expect,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an isolated config directory with auth.json pre-populated. */
function createConfigDir(prefix: string): string {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), `opentabs-e2e-plugindirs-${prefix}-`));
  const extensionDir = path.join(configDir, 'extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  const secret = crypto.randomUUID();
  fs.writeFileSync(path.join(extensionDir, 'auth.json'), `${JSON.stringify({ secret })}\n`, 'utf-8');
  return configDir;
}

// ---------------------------------------------------------------------------
// localPluginDirs discovery
// ---------------------------------------------------------------------------

test.describe('localPluginDirs — directory scanning', () => {
  test('plugins in localPluginDirs are auto-discovered and appear in /health', async () => {
    let configDir: string | undefined;
    let tmpDir: string | undefined;
    let server: McpServer | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-plugindirs-scan-'));

      // Create a parent dir with two minimal plugin subdirectories
      const parentDir = path.join(tmpDir, 'my-plugins');
      fs.mkdirSync(parentDir, { recursive: true });
      createMinimalPlugin(parentDir, 'alpha', [{ name: 'ping', description: 'Ping tool' }]);
      createMinimalPlugin(parentDir, 'beta', [{ name: 'pong', description: 'Pong tool' }]);

      configDir = createConfigDir('scan');
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        localPluginDirs: [parentDir],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
          alpha: { permission: 'auto' },
          beta: { permission: 'auto' },
        },
      });

      server = await startMcpServer(configDir, true);
      const health = await server.waitForHealth(h => (h.pluginDetails?.length ?? 0) >= 3, 15_000);

      // All three plugins should be discovered
      const names = health.pluginDetails?.map(p => p.name) ?? [];
      expect(names).toContain('e2e-test');
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('non-existent localPluginDirs entry is silently skipped', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      configDir = createConfigDir('nonexist');
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const bogusDir = path.join(os.tmpdir(), `nonexistent-dir-${String(Date.now())}`);

      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        localPluginDirs: [bogusDir],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
      });

      server = await startMcpServer(configDir, true);
      const health = await server.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

      // The valid e2e-test plugin should still load
      const e2ePlugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(e2ePlugin).toBeDefined();
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('empty directory discovers zero additional plugins', async () => {
    let configDir: string | undefined;
    let tmpDir: string | undefined;
    let server: McpServer | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-plugindirs-empty-'));
      const emptyParent = path.join(tmpDir, 'empty-plugins');
      fs.mkdirSync(emptyParent, { recursive: true });

      configDir = createConfigDir('empty');
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        localPluginDirs: [emptyParent],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
      });

      server = await startMcpServer(configDir, true);
      const health = await server.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

      // Only the e2e-test plugin from localPlugins should be present
      expect(health.pluginDetails?.length).toBe(1);
      expect(health.pluginDetails?.[0]?.name).toBe('e2e-test');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('directories without opentabs field are skipped', async () => {
    let configDir: string | undefined;
    let tmpDir: string | undefined;
    let server: McpServer | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-plugindirs-noop-'));
      const parentDir = path.join(tmpDir, 'mixed-plugins');
      fs.mkdirSync(parentDir, { recursive: true });

      // Create a valid plugin
      createMinimalPlugin(parentDir, 'valid-one', [{ name: 'hello', description: 'Hello tool' }]);

      // Create a directory with package.json but NO opentabs field
      const nonPluginDir = path.join(parentDir, 'not-a-plugin');
      fs.mkdirSync(nonPluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(nonPluginDir, 'package.json'),
        JSON.stringify({ name: 'not-a-plugin', version: '1.0.0' }),
      );

      // Create a directory without package.json at all
      const bareDir = path.join(parentDir, 'bare-dir');
      fs.mkdirSync(bareDir, { recursive: true });

      configDir = createConfigDir('noop');
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        localPluginDirs: [parentDir],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
          'valid-one': { permission: 'auto' },
        },
      });

      server = await startMcpServer(configDir, true);
      const health = await server.waitForHealth(h => (h.pluginDetails?.length ?? 0) >= 2, 15_000);

      // Only the e2e-test and valid-one plugins should be discovered
      const names = health.pluginDetails?.map(p => p.name) ?? [];
      expect(names).toContain('e2e-test');
      expect(names).toContain('valid-one');
      expect(names).not.toContain('not-a-plugin');
      expect(names).not.toContain('bare-dir');
      expect(health.pluginDetails?.length).toBe(2);
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// localPlugins / localPluginDirs deduplication
// ---------------------------------------------------------------------------

test.describe('localPluginDirs — deduplication', () => {
  test('localPlugins entries take precedence over localPluginDirs-scanned duplicates', async () => {
    let configDir: string | undefined;
    let tmpDir: string | undefined;
    let server: McpServer | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-plugindirs-dedup-'));
      const parentDir = path.join(tmpDir, 'dedup-plugins');
      fs.mkdirSync(parentDir, { recursive: true });

      // Create a plugin in the parent dir
      const pluginPath = createMinimalPlugin(parentDir, 'shared-plugin', [
        { name: 'hello', description: 'Hello tool' },
      ]);

      configDir = createConfigDir('dedup');
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      // Register the same plugin via both localPlugins AND localPluginDirs
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath, pluginPath],
        localPluginDirs: [parentDir],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
          'shared-plugin': { permission: 'auto' },
        },
      });

      server = await startMcpServer(configDir, true);
      const health = await server.waitForHealth(h => (h.pluginDetails?.length ?? 0) >= 2, 15_000);

      // shared-plugin should appear exactly once (not duplicated)
      const sharedPlugins = health.pluginDetails?.filter(p => p.name === 'shared-plugin') ?? [];
      expect(sharedPlugins.length).toBe(1);

      // Both e2e-test and shared-plugin should be present
      const names = health.pluginDetails?.map(p => p.name) ?? [];
      expect(names).toContain('e2e-test');
      expect(names).toContain('shared-plugin');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
