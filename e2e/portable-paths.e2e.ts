/**
 * E2E tests for portable path normalization — verify that the v2→v3 config
 * migration normalizes absolute paths under HOME to ~/ prefix, preserves
 * relative paths, is idempotent, and that the server resolves ~/ paths
 * correctly for plugin discovery.
 *
 * All tests use isolated config directories and dynamic ports for parallel
 * execution safety.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from './fixtures.js';
import { cleanupTestConfigDir, createMinimalPlugin, expect, startMcpServer, test } from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a raw config.json to a config directory (exact JSON, no auto-generation). */
function writeRawConfig(configDir: string, raw: Record<string, unknown>): void {
  fs.writeFileSync(path.join(configDir, 'config.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
}

/** Read config.json from disk and parse as raw JSON. */
function readRawConfig(configDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
}

/** Create an isolated config directory with auth.json pre-populated. */
function createConfigDir(prefix: string): string {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), `opentabs-e2e-portable-${prefix}-`));
  const extensionDir = path.join(configDir, 'extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  const secret = crypto.randomUUID();
  fs.writeFileSync(path.join(extensionDir, 'auth.json'), `${JSON.stringify({ secret })}\n`, 'utf-8');
  return configDir;
}

// ---------------------------------------------------------------------------
// v2 → v3 migration: path normalization
// ---------------------------------------------------------------------------

test.describe('Portable paths — v2→v3 migration', () => {
  test('v2→v3 migration normalizes absolute paths under HOME to ~/', async () => {
    let configDir: string | undefined;
    let tmpDir: string | undefined;
    let server: McpServer | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-portable-migrate-'));
      const home = os.homedir();

      // Create a minimal plugin under HOME so the path can be normalized
      const pluginParent = path.join(tmpDir, 'plugins');
      fs.mkdirSync(pluginParent, { recursive: true });
      const pluginPath = createMinimalPlugin(pluginParent, 'migrated-plugin', [
        { name: 'hello', description: 'Hello tool' },
      ]);

      configDir = createConfigDir('migrate');
      // Write a v2 config with an absolute path under HOME
      // Since the plugin is in /tmp (not under HOME), we also add a path that IS
      // under HOME to test normalization. We use the actual homedir + a fake suffix
      // to verify the migration logic without requiring real plugins under HOME.
      writeRawConfig(configDir, {
        version: 2,
        localPlugins: [`${home}/fake-plugin-dir/my-plugin`, pluginPath, '/tmp/other-plugin'],
        permissions: {
          browser: { permission: 'auto' },
        },
        settings: {},
      });

      server = await startMcpServer(configDir, true);
      // Wait for server to start (migration runs during startup)
      await server.waitForHealth(h => h.status === 'ok');

      // Read the migrated config
      const migrated = readRawConfig(configDir);

      // Version should be updated to 3
      expect(migrated.version).toBe(3);

      const localPlugins = migrated.localPlugins as string[];

      // Path under HOME should be converted to ~/...
      expect(localPlugins[0]).toBe('~/fake-plugin-dir/my-plugin');

      // Path in /tmp (not under HOME) should remain absolute
      expect(localPlugins[1]).toBe(pluginPath);

      // Path in /tmp/other-plugin should remain absolute
      expect(localPlugins[2]).toBe('/tmp/other-plugin');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('migration preserves relative paths unchanged', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      configDir = createConfigDir('relative');
      writeRawConfig(configDir, {
        version: 2,
        localPlugins: ['./relative-plugin', '../parent-plugin'],
        permissions: {
          browser: { permission: 'auto' },
        },
        settings: {},
      });

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      const migrated = readRawConfig(configDir);
      expect(migrated.version).toBe(3);

      const localPlugins = migrated.localPlugins as string[];
      // Relative paths should not be modified
      expect(localPlugins[0]).toBe('./relative-plugin');
      expect(localPlugins[1]).toBe('../parent-plugin');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('migration is idempotent — ~/paths stay as ~/ on re-migration', async () => {
    let configDir: string | undefined;
    let server1: McpServer | undefined;
    let server2: McpServer | undefined;
    try {
      configDir = createConfigDir('idempotent');
      const home = os.homedir();

      // Write a v2 config with an absolute path under HOME
      writeRawConfig(configDir, {
        version: 2,
        localPlugins: [`${home}/workspace/my-plugin`],
        permissions: {
          browser: { permission: 'auto' },
        },
        settings: {},
      });

      // First server start triggers v2→v3 migration
      server1 = await startMcpServer(configDir, true);
      await server1.waitForHealth(h => h.status === 'ok');
      await server1.kill();
      server1 = undefined;

      const afterFirst = readRawConfig(configDir);
      expect(afterFirst.version).toBe(3);
      expect((afterFirst.localPlugins as string[])[0]).toBe('~/workspace/my-plugin');

      // Manually set version back to 2 to force re-migration
      writeRawConfig(configDir, { ...afterFirst, version: 2 });

      // Second server start triggers migration again
      server2 = await startMcpServer(configDir, true);
      await server2.waitForHealth(h => h.status === 'ok');

      const afterSecond = readRawConfig(configDir);
      expect(afterSecond.version).toBe(3);
      // ~/... path should remain unchanged (not double-prefixed)
      expect((afterSecond.localPlugins as string[])[0]).toBe('~/workspace/my-plugin');
    } finally {
      await server1?.kill();
      await server2?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Server resolves ~/ paths correctly for plugin discovery
// ---------------------------------------------------------------------------

test.describe('Portable paths — ~/ resolution', () => {
  test('server resolves ~/ paths correctly and discovers the plugin', async () => {
    let configDir: string | undefined;
    let tmpDir: string | undefined;
    let server: McpServer | undefined;
    try {
      // Create a plugin under HOME so we can reference it as ~/...
      const home = os.homedir();
      tmpDir = fs.mkdtempSync(path.join(home, '.opentabs-e2e-portable-resolve-'));

      const pluginPath = createMinimalPlugin(tmpDir, 'home-plugin', [{ name: 'greet', description: 'Greet tool' }]);

      // Convert absolute path to ~/ form
      const portablePath = `~/${pluginPath.slice(home.length + 1)}`;

      configDir = createConfigDir('resolve');
      writeRawConfig(configDir, {
        version: 3,
        localPlugins: [portablePath],
        permissions: {
          browser: { permission: 'auto' },
          'home-plugin': { permission: 'auto' },
        },
        settings: {},
      });

      server = await startMcpServer(configDir, true);
      const health = await server.waitForHealth(
        h => h.pluginDetails !== undefined && h.pluginDetails.length > 0,
        15_000,
      );

      // The plugin should be discovered via the ~/ path
      const plugin = health.pluginDetails?.find(p => p.name === 'home-plugin');
      expect(plugin).toBeDefined();
      expect(plugin?.toolCount).toBe(1);
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
