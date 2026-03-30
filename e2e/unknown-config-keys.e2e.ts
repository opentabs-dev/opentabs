/**
 * E2E tests for unknown config key warnings — verify that the server warns
 * about unrecognized top-level config keys and includes Levenshtein-based
 * "did you mean" suggestions for close matches.
 *
 * All tests use isolated config directories and dynamic ports for parallel
 * execution safety.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from './fixtures.js';
import { cleanupTestConfigDir, E2E_TEST_PLUGIN_DIR, expect, startMcpServer, test } from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an isolated config directory with auth.json pre-populated. */
function createConfigDir(prefix: string): string {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), `opentabs-e2e-unknown-keys-${prefix}-`));
  const extensionDir = path.join(configDir, 'extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  const secret = crypto.randomUUID();
  fs.writeFileSync(path.join(extensionDir, 'auth.json'), `${JSON.stringify({ secret })}\n`, 'utf-8');
  return configDir;
}

/** Write raw config.json to a config directory (exact JSON, no auto-generation). */
function writeRawConfig(configDir: string, raw: Record<string, unknown>): void {
  fs.writeFileSync(path.join(configDir, 'config.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Unknown config key warnings', () => {
  test('unknown config key produces warning in server output', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      configDir = createConfigDir('basic-warn');
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      writeRawConfig(configDir, {
        version: 3,
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {},
        typo_field: true,
      });

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      // Server logs should contain a warning about the unknown key
      const warningLine = server.logs.find(line => line.includes('Unknown config key') && line.includes('typo_field'));
      expect(warningLine).toBeDefined();
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('close-match unknown key includes "did you mean" suggestion', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      configDir = createConfigDir('did-you-mean');
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      // "localPlugin" is one edit away from "localPlugins"
      writeRawConfig(configDir, {
        version: 3,
        localPlugin: [absPluginPath],
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {},
      });

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      // Server logs should contain a warning with a "did you mean" suggestion
      const warningLine = server.logs.find(
        line => line.includes('Unknown config key') && line.includes('localPlugin') && line.includes('did you mean'),
      );
      expect(warningLine).toBeDefined();
      expect(warningLine).toContain("'localPlugins'");
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('server starts successfully with unknown keys and plugins are still discovered', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      configDir = createConfigDir('still-works');
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

      writeRawConfig(configDir, {
        version: 3,
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
        settings: {},
        bogus_key: 'should-be-ignored',
        another_unknown: 42,
      });

      server = await startMcpServer(configDir, true);
      const health = await server.waitForHealth(
        h => h.pluginDetails !== undefined && h.pluginDetails.length > 0,
        15_000,
      );

      // The e2e-test plugin should still be discovered despite unknown keys
      const plugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(plugin).toBeDefined();
      expect(plugin?.toolCount).toBeGreaterThan(0);
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});
