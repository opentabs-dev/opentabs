/**
 * E2E tests for the npm auto-discovery pipeline — verifies that the MCP server
 * discovers plugins from global node_modules when OPENTABS_SKIP_NPM_DISCOVERY
 * is not set, that discovered plugins appear in the /health endpoint with
 * source='npm', and that local plugins override npm plugins of the same name.
 *
 * Uses NPM_CONFIG_PREFIX to redirect `npm root -g` to a temp directory,
 * avoiding any modification to the real global node_modules.
 */

import {
  test,
  expect,
  startMcpServer,
  createMcpClient,
  cleanupTestConfigDir,
  writeTestConfig,
  readPluginToolNames,
  E2E_TEST_PLUGIN_DIR,
} from './fixtures.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer, McpClient } from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fake npm global prefix directory containing a plugin under
 * `<prefix>/lib/node_modules/<packageName>/`. Returns the prefix path
 * and the plugin directory path.
 *
 * NPM_CONFIG_PREFIX causes `npm root -g` to return `<prefix>/lib/node_modules`,
 * which is then scanned by the auto-discovery pipeline.
 */
const createNpmPrefixWithPlugin = (
  pluginName: string,
  tools: Array<{ name: string; description: string }>,
): { prefixDir: string; pluginDir: string; globalNodeModules: string } => {
  const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-prefix-'));
  const globalNodeModules = path.join(prefixDir, 'lib', 'node_modules');
  const npmPkgName = `opentabs-plugin-${pluginName}`;
  const pluginDir = path.join(globalNodeModules, npmPkgName);
  fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });

  fs.writeFileSync(
    path.join(pluginDir, 'package.json'),
    JSON.stringify({
      name: npmPkgName,
      version: '1.0.0',
      type: 'module',
      main: 'dist/adapter.iife.js',
      opentabs: {
        displayName: `NPM ${pluginName}`,
        description: `Auto-discovered npm test plugin: ${pluginName}`,
        urlPatterns: ['http://localhost/*'],
      },
    }),
  );

  const toolDefs = tools.map(t => ({
    name: t.name,
    displayName: t.name
      .split(/[_-]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    description: t.description,
    icon: 'wrench',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    output_schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
  }));

  fs.writeFileSync(
    path.join(pluginDir, 'dist', 'tools.json'),
    JSON.stringify({ tools: toolDefs, resources: [], prompts: [] }),
  );

  const iife = [
    '(function() {',
    '  if (!globalThis.__openTabs) globalThis.__openTabs = { adapters: {} };',
    `  globalThis.__openTabs.adapters[${JSON.stringify(pluginName)}] = {`,
    '    isReady: function() { return false; },',
    '    tools: {}',
    '  };',
    '})();',
  ].join('\n');
  fs.writeFileSync(path.join(pluginDir, 'dist', 'adapter.iife.js'), iife);

  return { prefixDir, pluginDir, globalNodeModules };
};

/**
 * Build a config with the e2e-test plugin plus optional extras.
 */
const configWithPlugins = (
  extraLocalPlugins: string[] = [],
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

/**
 * Environment overrides that enable npm auto-discovery with a controlled prefix.
 * Removes OPENTABS_SKIP_NPM_DISCOVERY by setting it to undefined (which deletes
 * it from the env object) and sets NPM_CONFIG_PREFIX to redirect `npm root -g`.
 */
const npmDiscoveryEnv = (prefixDir: string): Record<string, string | undefined> => ({
  OPENTABS_SKIP_NPM_DISCOVERY: undefined,
  NPM_CONFIG_PREFIX: prefixDir,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('npm auto-discovery pipeline', () => {
  test('npm-installed plugins are discovered when OPENTABS_SKIP_NPM_DISCOVERY is not set', async () => {
    const { prefixDir } = createNpmPrefixWithPlugin('npm-disc-basic', [
      { name: 'ping', description: 'A basic ping tool' },
    ]);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-disc-basic-cfg-'));
    const config = configWithPlugins([], { 'npm-disc-basic_ping': true });
    writeTestConfig(configDir, config);

    let server: McpServer | undefined;
    try {
      server = await startMcpServer(configDir, true, undefined, npmDiscoveryEnv(prefixDir));
      const health = await server.waitForHealth(h => {
        const npmPlugin = h.pluginDetails?.find(p => p.name === 'npm-disc-basic');
        return npmPlugin !== undefined;
      }, 30_000);

      const npmPlugin = health.pluginDetails?.find(p => p.name === 'npm-disc-basic');
      expect(npmPlugin).toBeDefined();
      expect(npmPlugin?.source).toBe('npm');
      expect(npmPlugin?.toolCount).toBe(1);
      expect(npmPlugin?.displayName).toBe('NPM npm-disc-basic');
    } finally {
      await server?.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(prefixDir, { recursive: true, force: true });
    }
  });

  test('discovered npm plugins appear in /health with source=npm and tools are listed via MCP', async () => {
    const { prefixDir } = createNpmPrefixWithPlugin('npm-disc-health', [
      { name: 'status', description: 'Get status' },
      { name: 'info', description: 'Get info' },
    ]);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-disc-health-cfg-'));
    const config = configWithPlugins([], {
      'npm-disc-health_status': true,
      'npm-disc-health_info': true,
    });
    writeTestConfig(configDir, config);

    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      server = await startMcpServer(configDir, true, undefined, npmDiscoveryEnv(prefixDir));
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const health = await server.waitForHealth(h => {
        const npmPlugin = h.pluginDetails?.find(p => p.name === 'npm-disc-health');
        return npmPlugin !== undefined;
      }, 30_000);

      // Verify /health response fields
      const npmPlugin = health.pluginDetails?.find(p => p.name === 'npm-disc-health');
      expect(npmPlugin).toBeDefined();
      expect(npmPlugin?.source).toBe('npm');
      expect(npmPlugin?.toolCount).toBe(2);
      expect(npmPlugin?.tabState).toBe('closed');

      // Verify tools appear in MCP tools/list
      const tools = await client.listTools();
      expect(tools.some(t => t.name === 'npm-disc-health_status')).toBe(true);
      expect(tools.some(t => t.name === 'npm-disc-health_info')).toBe(true);
    } finally {
      await client?.close();
      await server?.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(prefixDir, { recursive: true, force: true });
    }
  });

  test('npm plugin tools are callable via MCP tool dispatch (returns tab-not-ready without browser)', async () => {
    const { prefixDir } = createNpmPrefixWithPlugin('npm-disc-call', [
      { name: 'echo', description: 'Echo back input' },
    ]);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-disc-call-cfg-'));
    const config = configWithPlugins([], { 'npm-disc-call_echo': true });
    writeTestConfig(configDir, config);

    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      server = await startMcpServer(configDir, true, undefined, npmDiscoveryEnv(prefixDir));
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      await server.waitForHealth(h => {
        const npmPlugin = h.pluginDetails?.find(p => p.name === 'npm-disc-call');
        return npmPlugin !== undefined;
      }, 30_000);

      // Tool dispatch should fail because no browser extension is connected
      // (tab state is 'closed'), but the tool is recognized and dispatched.
      const result = await client.callTool('npm-disc-call_echo', {});
      expect(result.isError).toBe(true);
      // The error message should indicate the tab is not ready, not "unknown tool"
      expect(result.content).not.toContain('Unknown tool');
    } finally {
      await client?.close();
      await server?.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(prefixDir, { recursive: true, force: true });
    }
  });

  test('local plugins override npm plugins of the same name', async () => {
    // Create an npm plugin named "e2e-test" (same as the local e2e-test plugin)
    // using the scoped name format that matches the official scope
    const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-disc-override-prefix-'));
    const globalNodeModules = path.join(prefixDir, 'lib', 'node_modules');
    const scopeDir = path.join(globalNodeModules, '@opentabs-dev');
    const pluginDir = path.join(scopeDir, 'opentabs-plugin-e2e-test');
    fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });

    // The npm version has a distinctive displayName to differentiate it
    fs.writeFileSync(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({
        name: '@opentabs-dev/opentabs-plugin-e2e-test',
        version: '999.0.0',
        type: 'module',
        main: 'dist/adapter.iife.js',
        opentabs: {
          displayName: 'NPM E2E Test (should be overridden)',
          description: 'npm version of e2e-test that should be overridden by local',
          urlPatterns: ['http://localhost/*'],
        },
      }),
    );

    fs.writeFileSync(
      path.join(pluginDir, 'dist', 'tools.json'),
      JSON.stringify({
        tools: [
          {
            name: 'npm-only-tool',
            displayName: 'NPM Only Tool',
            description: 'A tool only in the npm version',
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
        resources: [],
        prompts: [],
      }),
    );

    const iife = [
      '(function() {',
      '  if (!globalThis.__openTabs) globalThis.__openTabs = { adapters: {} };',
      '  globalThis.__openTabs.adapters["e2e-test"] = {',
      '    isReady: function() { return false; },',
      '    tools: {}',
      '  };',
      '})();',
    ].join('\n');
    fs.writeFileSync(path.join(pluginDir, 'dist', 'adapter.iife.js'), iife);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-disc-override-cfg-'));
    const config = configWithPlugins();
    writeTestConfig(configDir, config);

    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      server = await startMcpServer(configDir, true, undefined, npmDiscoveryEnv(prefixDir));
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const health = await server.waitForHealth(h => {
        const plugin = h.pluginDetails?.find(p => p.name === 'e2e-test');
        return plugin !== undefined;
      }, 30_000);

      // The local e2e-test plugin should win over the npm version
      const e2ePlugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(e2ePlugin).toBeDefined();
      expect(e2ePlugin?.source).toBe('local');
      // The local version has its own displayName and tools — verify it's not the npm version
      expect(e2ePlugin?.displayName).not.toBe('NPM E2E Test (should be overridden)');

      // tools/list should contain the local e2e-test tools, not the npm-only-tool
      const tools = await client.listTools();
      expect(tools.some(t => t.name.startsWith('e2e-test_'))).toBe(true);
      expect(tools.some(t => t.name === 'e2e-test_npm-only-tool')).toBe(false);
    } finally {
      await client?.close();
      await server?.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(prefixDir, { recursive: true, force: true });
    }
  });

  test('empty npm discovery when no plugins are installed in global node_modules', async () => {
    // Create an empty npm prefix with no plugins
    const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-disc-empty-prefix-'));
    const globalNodeModules = path.join(prefixDir, 'lib', 'node_modules');
    fs.mkdirSync(globalNodeModules, { recursive: true });

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-disc-empty-cfg-'));
    const config = configWithPlugins();
    writeTestConfig(configDir, config);

    let server: McpServer | undefined;
    try {
      server = await startMcpServer(configDir, true, undefined, npmDiscoveryEnv(prefixDir));
      const health = await server.waitForHealth(h => h.status === 'ok', 30_000);

      // Only local plugins should be present (the e2e-test plugin)
      expect(health.pluginDetails).toBeDefined();
      const allPlugins = health.pluginDetails ?? [];
      const npmPlugins = allPlugins.filter(p => p.source === 'npm');
      expect(npmPlugins).toHaveLength(0);

      // The local e2e-test plugin should still load
      const e2ePlugin = allPlugins.find(p => p.name === 'e2e-test');
      expect(e2ePlugin).toBeDefined();
      expect(e2ePlugin?.source).toBe('local');
    } finally {
      await server?.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(prefixDir, { recursive: true, force: true });
    }
  });
});
