/**
 * E2E tests for plugin discovery edge cases — verify that broken plugins
 * produce clear errors in failedPlugins, that valid plugins still load when
 * one is broken, and that fixing a broken plugin transitions it to healthy.
 *
 * All tests use isolated config directories and dynamic ports for parallel
 * execution safety.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpClient, McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createMinimalPlugin,
  E2E_TEST_PLUGIN_DIR,
  expect,
  readPluginToolNames,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import { BROWSER_TOOL_NAMES } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a config with the e2e-test plugin plus any additional localPlugins.
 * Returns the config object ready for writeTestConfig.
 */
const configWithPlugins = (
  extraLocalPlugins: string[],
  extraTools: Record<string, boolean> = {},
): { localPlugins: string[]; tools: Record<string, boolean> } => {
  const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
  const prefixedToolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const t of prefixedToolNames) {
    tools[t] = true;
  }
  return {
    localPlugins: [absPluginPath, ...extraLocalPlugins],
    tools: { ...tools, ...extraTools },
  };
};

// ---------------------------------------------------------------------------
// US-009: Discovery edge cases — broken plugins
// ---------------------------------------------------------------------------

test.describe('Discovery edge cases — broken plugins', () => {
  test('non-existent local plugin path is silently skipped, valid plugin still loads', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-nodir-'));
      const bogusPath = path.join(os.tmpdir(), `nonexistent-plugin-${String(Date.now())}`);
      const config = configWithPlugins([bogusPath]);
      writeTestConfig(configDir, config);

      server = await startMcpServer(configDir, true);
      const health = await server.waitForHealth(h => h.status === 'ok');

      const raw = await fetch(`http://localhost:${String(server.port)}/health`, {
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await raw.json()) as {
        failedPlugins: Array<{ path: string; error: string }>;
        discoveryErrors: Array<{ specifier: string; error: string }>;
        pluginDetails?: Array<{ name: string }>;
      };

      // Nonexistent paths are treated as stale config entries and silently
      // skipped — they do not appear in failedPlugins.
      const failure = body.failedPlugins.find(f => f.path.includes('nonexistent-plugin'));
      expect(failure).toBeUndefined();

      // Stale paths still appear in discoveryErrors for diagnostic visibility.
      const staleError = body.discoveryErrors.find(e => e.specifier.includes('nonexistent-plugin'));
      expect(staleError).toBeDefined();
      expect(staleError?.error).toContain('Path not found');

      // The valid e2e-test plugin should still load
      expect(health.pluginDetails).toBeDefined();
      const e2ePlugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(e2ePlugin).toBeDefined();
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('local plugin with missing dist/tools.json appears in failedPlugins', async () => {
    let tmpDir: string | undefined;
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-notools-'));

      // Create a plugin directory with package.json and adapter IIFE but no tools.json
      const pluginDir = path.join(tmpDir, 'broken-no-tools');
      fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({
          name: 'opentabs-plugin-broken-no-tools',
          version: '0.0.1',
          type: 'module',
          main: 'dist/adapter.iife.js',
          opentabs: {
            displayName: 'Broken No Tools',
            description: 'Plugin with missing tools.json',
            urlPatterns: ['http://localhost/*'],
          },
        }),
      );
      fs.writeFileSync(path.join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})();');
      // Intentionally NOT writing dist/tools.json

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-notools-cfg-'));
      const config = configWithPlugins([path.resolve(pluginDir)]);
      writeTestConfig(configDir, config);

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      const raw = await fetch(`http://localhost:${String(server.port)}/health`, {
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await raw.json()) as {
        failedPlugins: Array<{ path: string; error: string }>;
      };

      const failure = body.failedPlugins.find(f => f.path.includes('broken-no-tools'));
      expect(failure).toBeDefined();
      expect(failure?.error).toContain('tools.json');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('local plugin with invalid JSON in dist/tools.json appears in failedPlugins', async () => {
    let tmpDir: string | undefined;
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-badjson-'));

      // Create a plugin directory with all files but tools.json has invalid JSON
      const pluginDir = path.join(tmpDir, 'broken-bad-json');
      fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({
          name: 'opentabs-plugin-broken-bad-json',
          version: '0.0.1',
          type: 'module',
          main: 'dist/adapter.iife.js',
          opentabs: {
            displayName: 'Broken Bad JSON',
            description: 'Plugin with invalid tools.json',
            urlPatterns: ['http://localhost/*'],
          },
        }),
      );
      fs.writeFileSync(path.join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})();');
      fs.writeFileSync(path.join(pluginDir, 'dist', 'tools.json'), '{ this is not valid json !!!');

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-badjson-cfg-'));
      const config = configWithPlugins([path.resolve(pluginDir)]);
      writeTestConfig(configDir, config);

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      const raw = await fetch(`http://localhost:${String(server.port)}/health`, {
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await raw.json()) as {
        failedPlugins: Array<{ path: string; error: string }>;
      };

      const failure = body.failedPlugins.find(f => f.path.includes('broken-bad-json'));
      expect(failure).toBeDefined();
      expect(failure?.error).toContain('tools.json');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('local plugin with missing dist/adapter.iife.js appears in failedPlugins', async () => {
    let tmpDir: string | undefined;
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-noiife-'));

      // Create a plugin directory with package.json and tools.json but no adapter IIFE
      const pluginDir = path.join(tmpDir, 'broken-no-iife');
      fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({
          name: 'opentabs-plugin-broken-no-iife',
          version: '0.0.1',
          type: 'module',
          main: 'dist/adapter.iife.js',
          opentabs: {
            displayName: 'Broken No IIFE',
            description: 'Plugin with missing adapter',
            urlPatterns: ['http://localhost/*'],
          },
        }),
      );
      fs.writeFileSync(path.join(pluginDir, 'dist', 'tools.json'), JSON.stringify({ tools: [] }));
      // Intentionally NOT writing dist/adapter.iife.js

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-noiife-cfg-'));
      const config = configWithPlugins([path.resolve(pluginDir)]);
      writeTestConfig(configDir, config);

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      const raw = await fetch(`http://localhost:${String(server.port)}/health`, {
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await raw.json()) as {
        failedPlugins: Array<{ path: string; error: string }>;
      };

      const failure = body.failedPlugins.find(f => f.path.includes('broken-no-iife'));
      expect(failure).toBeDefined();
      expect(failure?.error).toContain('Adapter IIFE');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('valid plugins still load when one plugin in localPlugins is broken', async () => {
    let tmpDir: string | undefined;
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-partial-'));

      // Create a broken plugin (missing tools.json)
      const brokenDir = path.join(tmpDir, 'broken-partial');
      fs.mkdirSync(path.join(brokenDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(brokenDir, 'package.json'),
        JSON.stringify({
          name: 'opentabs-plugin-broken-partial',
          version: '0.0.1',
          type: 'module',
          main: 'dist/adapter.iife.js',
          opentabs: {
            displayName: 'Broken Partial',
            description: 'Plugin with missing tools.json for partial load test',
            urlPatterns: ['http://localhost/*'],
          },
        }),
      );
      fs.writeFileSync(path.join(brokenDir, 'dist', 'adapter.iife.js'), '(function(){})();');
      // No tools.json

      // Create a second valid minimal plugin
      const validDir = createMinimalPlugin(tmpDir, 'valid-partial', [{ name: 'ping', description: 'A ping tool' }]);

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-partial-cfg-'));
      const config = configWithPlugins([path.resolve(brokenDir), validDir], {
        'valid-partial_ping': true,
      });
      writeTestConfig(configDir, config);

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const health = await server.waitForHealth(h => h.status === 'ok');

      // The broken plugin should be in failedPlugins
      const raw = await fetch(`http://localhost:${String(server.port)}/health`, {
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await raw.json()) as {
        failedPlugins: Array<{ path: string; error: string }>;
      };
      const failure = body.failedPlugins.find(f => f.path.includes('broken-partial'));
      expect(failure).toBeDefined();

      // The valid e2e-test plugin should still be loaded
      expect(health.pluginDetails).toBeDefined();
      const e2ePlugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(e2ePlugin).toBeDefined();

      // The second valid plugin should also be loaded
      const validPlugin = health.pluginDetails?.find(p => p.name === 'valid-partial');
      expect(validPlugin).toBeDefined();
      expect(validPlugin?.toolCount).toBe(1);

      // Verify tools/list includes tools from both valid plugins
      const tools = await client.listTools();
      expect(tools.some(t => t.name.startsWith('e2e-test_'))).toBe(true);
      expect(tools.some(t => t.name === 'valid-partial_ping')).toBe(true);
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('fixing a broken plugin and calling POST /reload transitions it from failedPlugins to healthy', async () => {
    let tmpDir: string | undefined;
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-fix-'));

      // Create a plugin that starts broken (missing tools.json)
      const pluginDir = path.join(tmpDir, 'fixable');
      fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({
          name: 'opentabs-plugin-fixable',
          version: '0.0.1',
          type: 'module',
          main: 'dist/adapter.iife.js',
          opentabs: {
            displayName: 'Fixable Plugin',
            description: 'Plugin that starts broken then gets fixed',
            urlPatterns: ['http://localhost/*'],
          },
        }),
      );
      fs.writeFileSync(path.join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})();');
      // Intentionally NOT writing dist/tools.json yet

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-fix-cfg-'));
      const config = configWithPlugins([path.resolve(pluginDir)], { fixable_hello: true });
      writeTestConfig(configDir, config);
      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();
      await server.waitForHealth(h => h.status === 'ok');

      // Verify the plugin is in failedPlugins initially
      const rawBefore = await fetch(`http://localhost:${String(server.port)}/health`, {
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      const bodyBefore = (await rawBefore.json()) as {
        failedPlugins: Array<{ path: string; error: string }>;
      };
      const failureBefore = bodyBefore.failedPlugins.find(f => f.path.includes('fixable'));
      expect(failureBefore).toBeDefined();

      // "Fix" the plugin by writing a valid tools.json
      fs.writeFileSync(
        path.join(pluginDir, 'dist', 'tools.json'),
        JSON.stringify({
          tools: [
            {
              name: 'hello',
              displayName: 'Hello',
              description: 'A hello tool',
              icon: 'wrench',
              input_schema: { type: 'object', properties: {}, additionalProperties: false },
              output_schema: {
                type: 'object',
                properties: { ok: { type: 'boolean' } },
                required: ['ok'],
                additionalProperties: false,
              },
            },
          ],
        }),
      );

      // Replace the no-op adapter with one that registers properly
      const iife = [
        '(function() {',
        '  if (!globalThis.__openTabs) globalThis.__openTabs = { adapters: {} };',
        '  globalThis.__openTabs.adapters["fixable"] = {',
        '    isReady: function() { return false; },',
        '    tools: {}',
        '  };',
        '})();',
      ].join('\n');
      fs.writeFileSync(path.join(pluginDir, 'dist', 'adapter.iife.js'), iife);

      // Trigger rediscovery via POST /reload
      const reloadRes = await fetch(`http://localhost:${String(server.port)}/reload`, {
        method: 'POST',
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(10_000),
      });
      expect(reloadRes.ok).toBe(true);

      // Wait for the health endpoint to reflect the fixed plugin
      const healthAfter = await server.waitForHealth(h => {
        const fixablePlugin = h.pluginDetails?.find(p => p.name === 'fixable');
        return fixablePlugin !== undefined;
      }, 15_000);

      // Verify the fixable plugin is now in pluginDetails (not failedPlugins)
      const fixablePlugin = healthAfter.pluginDetails?.find(p => p.name === 'fixable');
      expect(fixablePlugin).toBeDefined();
      expect(fixablePlugin?.toolCount).toBe(1);
      expect(fixablePlugin?.displayName).toBe('Fixable Plugin');

      // Verify it's no longer in failedPlugins
      const rawAfter = await fetch(`http://localhost:${String(server.port)}/health`, {
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      const bodyAfter = (await rawAfter.json()) as {
        failedPlugins: Array<{ path: string; error: string }>;
      };
      const failureAfter = bodyAfter.failedPlugins.find(f => f.path.includes('fixable'));
      expect(failureAfter).toBeUndefined();

      // Verify the tool is now visible in tools/list
      const tools = await client.listTools();
      expect(tools.some(t => t.name === 'fixable_hello')).toBe(true);
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('3 broken + 2 valid plugins — valid MUST load with exact tool counts, broken in failedPlugins', async () => {
    let tmpDir: string | undefined;
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-stress-'));

      // --- 3 broken plugins with distinct failure modes ---

      // (a) Missing dist/tools.json
      const brokenNoToolsDir = path.join(tmpDir, 'broken-no-tools');
      fs.mkdirSync(path.join(brokenNoToolsDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(brokenNoToolsDir, 'package.json'),
        JSON.stringify({
          name: 'opentabs-plugin-broken-no-tools',
          version: '0.0.1',
          type: 'module',
          main: 'dist/adapter.iife.js',
          opentabs: {
            displayName: 'Broken No Tools',
            description: 'Missing tools.json',
            urlPatterns: ['http://localhost/*'],
          },
        }),
      );
      fs.writeFileSync(path.join(brokenNoToolsDir, 'dist', 'adapter.iife.js'), '(function(){})();');

      // (b) Corrupt adapter IIFE (syntax error in tools.json)
      const brokenCorruptDir = path.join(tmpDir, 'broken-corrupt');
      fs.mkdirSync(path.join(brokenCorruptDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(brokenCorruptDir, 'package.json'),
        JSON.stringify({
          name: 'opentabs-plugin-broken-corrupt',
          version: '0.0.1',
          type: 'module',
          main: 'dist/adapter.iife.js',
          opentabs: {
            displayName: 'Broken Corrupt',
            description: 'Corrupt tools.json',
            urlPatterns: ['http://localhost/*'],
          },
        }),
      );
      fs.writeFileSync(path.join(brokenCorruptDir, 'dist', 'adapter.iife.js'), '(function(){})();');
      fs.writeFileSync(path.join(brokenCorruptDir, 'dist', 'tools.json'), '{ INVALID JSON !!!');

      // (c) Missing opentabs field in package.json
      const brokenNoOpentabsDir = path.join(tmpDir, 'broken-no-opentabs');
      fs.mkdirSync(path.join(brokenNoOpentabsDir, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(brokenNoOpentabsDir, 'package.json'),
        JSON.stringify({
          name: 'opentabs-plugin-broken-no-opentabs',
          version: '0.0.1',
          type: 'module',
          main: 'dist/adapter.iife.js',
        }),
      );
      fs.writeFileSync(
        path.join(brokenNoOpentabsDir, 'dist', 'tools.json'),
        JSON.stringify({
          tools: [
            {
              name: 'ghost',
              displayName: 'Ghost',
              description: 'Should not load',
              icon: 'wrench',
              input_schema: { type: 'object', properties: {}, additionalProperties: false },
              output_schema: {
                type: 'object',
                properties: { ok: { type: 'boolean' } },
                required: ['ok'],
                additionalProperties: false,
              },
            },
          ],
        }),
      );
      fs.writeFileSync(path.join(brokenNoOpentabsDir, 'dist', 'adapter.iife.js'), '(function(){})();');

      // --- 2 valid plugins with known tool counts ---

      // valid-alpha: 2 tools
      const validAlphaDir = createMinimalPlugin(tmpDir, 'valid-alpha', [
        { name: 'ping', description: 'Alpha ping' },
        { name: 'pong', description: 'Alpha pong' },
      ]);

      // valid-beta: 3 tools
      const validBetaDir = createMinimalPlugin(tmpDir, 'valid-beta', [
        { name: 'read', description: 'Beta read' },
        { name: 'write', description: 'Beta write' },
        { name: 'delete', description: 'Beta delete' },
      ]);

      // --- Configure all 5 broken/valid plugins plus e2e-test ---
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const e2eToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of e2eToolNames) {
        tools[t] = true;
      }
      tools['valid-alpha_ping'] = true;
      tools['valid-alpha_pong'] = true;
      tools['valid-beta_read'] = true;
      tools['valid-beta_write'] = true;
      tools['valid-beta_delete'] = true;

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-disc-stress-cfg-'));
      writeTestConfig(configDir, {
        localPlugins: [
          absPluginPath,
          path.resolve(brokenNoToolsDir),
          path.resolve(brokenCorruptDir),
          path.resolve(brokenNoOpentabsDir),
          validAlphaDir,
          validBetaDir,
        ],
        tools,
      });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();
      const health = await server.waitForHealth(h => h.status === 'ok');

      // --- Verify broken plugins are in failedPlugins ---
      const raw = await fetch(`http://localhost:${String(server.port)}/health`, {
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await raw.json()) as {
        failedPlugins: Array<{ path: string; error: string }>;
        pluginDetails?: Array<{ name: string; toolCount: number }>;
      };

      expect(body.failedPlugins.length).toBeGreaterThanOrEqual(3);
      expect(body.failedPlugins.find(f => f.path.includes('broken-no-tools'))).toBeDefined();
      expect(body.failedPlugins.find(f => f.path.includes('broken-corrupt'))).toBeDefined();
      expect(body.failedPlugins.find(f => f.path.includes('broken-no-opentabs'))).toBeDefined();

      // --- Verify valid plugins loaded with exact tool counts ---
      expect(health.pluginDetails).toBeDefined();
      const alphaPlugin = health.pluginDetails?.find(p => p.name === 'valid-alpha');
      expect(alphaPlugin).toBeDefined();
      expect(alphaPlugin?.toolCount).toBe(2);

      const betaPlugin = health.pluginDetails?.find(p => p.name === 'valid-beta');
      expect(betaPlugin).toBeDefined();
      expect(betaPlugin?.toolCount).toBe(3);

      // --- Verify tools/list contains exactly the expected plugin tools ---
      const allTools = await client.listTools();
      const builtInToolSet = new Set([
        ...BROWSER_TOOL_NAMES,
        'plugin_inspect',
        'plugin_mark_reviewed',
        'plugin_get_workflow',
      ]);
      const pluginTools = allTools.filter(t => !builtInToolSet.has(t.name));

      // Expected: e2e-test tools + valid-alpha (2) + valid-beta (3)
      const expectedPluginToolCount = e2eToolNames.length + 2 + 3;
      expect(pluginTools.length).toBe(expectedPluginToolCount);

      // No duplicate tools
      const toolNames = pluginTools.map(t => t.name);
      expect(new Set(toolNames).size).toBe(toolNames.length);

      // No tools from broken plugins
      expect(toolNames.every(n => !n.startsWith('broken-'))).toBe(true);

      // Valid plugin tools are present
      expect(toolNames).toContain('valid-alpha_ping');
      expect(toolNames).toContain('valid-alpha_pong');
      expect(toolNames).toContain('valid-beta_read');
      expect(toolNames).toContain('valid-beta_write');
      expect(toolNames).toContain('valid-beta_delete');
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
