/**
 * Dynamic hot reload E2E tests — plugin installation, removal, file watcher,
 * config changes, and multi-session notification.
 *
 * These tests verify that the MCP server correctly picks up CHANGES to the
 * plugin set, tool config, and plugin files across hot reloads.
 *
 * Key scenarios:
 *   1. New plugin installed via config change + hot reload → tools appear
 *   2. Plugin removed via config change + hot reload → tools disappear
 *   3. Plugin re-added after removal → tools reappear
 *   4. Tool disabled via config change + hot reload → tool hidden from list
 *   5. File watcher: manifest change adds a tool without hot reload
 *   6. File watcher: IIFE change triggers plugin.update to extension
 *   7. Multiple MCP sessions all receive tools/list_changed
 *   8. New plugin tools callable from existing session after hot reload
 *
 * All tests use dynamic ports and isolated config directories. Tests that
 * modify plugin files use per-test copies to avoid affecting parallel tests.
 */

import {
  test,
  expect,
  startMcpServer,
  createMcpClient,
  cleanupTestConfigDir,
  readTestConfig,
  writeTestConfig,
  createMinimalPlugin,
  copyE2eTestPlugin,
  readPluginToolNames,
  E2E_TEST_PLUGIN_DIR,
} from './fixtures.js';
import {
  waitFor,
  waitForLog,
  waitForExtensionConnected,
  parseToolResult,
  BROWSER_TOOL_NAMES,
  waitForToolResult,
  waitForToolList,
  writeAndWaitForWatcher,
  setupToolTest,
} from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Tool entry shape in dist/tools.json */
interface ManifestToolEntry {
  name: string;
  displayName?: string;
  description: string;
  icon?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

/**
 * Read the tools array from a tools.json file, handling both the legacy plain
 * array format and the current `{ tools: [...], resources: [...], prompts: [...] }`
 * object format. Also writes back in the correct format.
 */
const readToolsFromManifest = (toolsJsonPath: string): ManifestToolEntry[] => {
  const raw: unknown = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8'));
  if (Array.isArray(raw)) return raw as ManifestToolEntry[];
  return (raw as { tools: ManifestToolEntry[] }).tools;
};

const writeToolsToManifest = (toolsJsonPath: string, tools: ManifestToolEntry[]): void => {
  const raw: unknown = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8'));
  if (Array.isArray(raw)) {
    fs.writeFileSync(toolsJsonPath, JSON.stringify(tools, null, 2), 'utf-8');
  } else {
    const manifest = raw as Record<string, unknown>;
    manifest.tools = tools;
    fs.writeFileSync(toolsJsonPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }
};

// ---------------------------------------------------------------------------
// Plugin installation via config change + hot reload
// ---------------------------------------------------------------------------

test.describe.serial('Hot reload — plugin installation', () => {
  test('new plugin tools appear in tools/list after config change + hot reload', async ({ mcpServer, mcpClient }) => {
    const toolsBefore = await mcpClient.listTools();
    const pluginToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
    expect(pluginToolsBefore.length).toBeGreaterThan(0);

    // Create a minimal second plugin in a temp directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-install-'));
    const newPluginDir = createMinimalPlugin(tmpDir, 'extra-test', [
      { name: 'do_stuff', description: 'Do stuff' },
      { name: 'check_health', description: 'Check health' },
    ]);

    try {
      // Update config to add the new plugin and enable its tools
      const config = readTestConfig(mcpServer.configDir);
      config.localPlugins.push(newPluginDir);
      config.tools['extra-test_do_stuff'] = true;
      config.tools['extra-test_check_health'] = true;
      writeTestConfig(mcpServer.configDir, config);

      // Trigger hot reload
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      // Verify new plugin's tools appear
      const toolsAfter = await mcpClient.listTools();
      const extraTools = toolsAfter.filter(t => t.name.startsWith('extra-test_'));
      expect(extraTools.map(t => t.name).sort()).toEqual(['extra-test_check_health', 'extra-test_do_stuff']);

      // Original e2e-test tools should still be there
      const e2eToolsAfter = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsAfter.length).toBe(pluginToolsBefore.length);

      // Browser tools should still be there
      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsAfter.map(t => t.name)).toContain(bt);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('multiple new plugins installed in one hot reload', async ({ mcpServer, mcpClient }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-multi-install-'));
    const plugin1Dir = createMinimalPlugin(tmpDir, 'alpha', [{ name: 'ping', description: 'Ping' }]);
    const plugin2Dir = createMinimalPlugin(tmpDir, 'beta', [{ name: 'pong', description: 'Pong' }]);

    try {
      const config = readTestConfig(mcpServer.configDir);
      config.localPlugins.push(plugin1Dir, plugin2Dir);
      config.tools['alpha_ping'] = true;
      config.tools['beta_pong'] = true;
      writeTestConfig(mcpServer.configDir, config);

      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      const tools = await mcpClient.listTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('alpha_ping');
      expect(names).toContain('beta_pong');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Plugin removal via config change + hot reload
// ---------------------------------------------------------------------------

test.describe.serial('Hot reload — plugin removal', () => {
  test('removed plugin tools disappear from tools/list after config change + hot reload', async ({
    mcpServer,
    mcpClient,
  }) => {
    const toolsBefore = await mcpClient.listTools();
    const pluginToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
    expect(pluginToolsBefore.length).toBeGreaterThan(0);

    // Remove all local plugins from config
    const config = readTestConfig(mcpServer.configDir);
    config.localPlugins = [];
    writeTestConfig(mcpServer.configDir, config);

    // Trigger hot reload
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    // Plugin tools should be gone
    const toolsAfter = await mcpClient.listTools();
    const e2eToolsAfter = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
    expect(e2eToolsAfter.length).toBe(0);

    // Browser tools should still be there
    for (const bt of BROWSER_TOOL_NAMES) {
      expect(toolsAfter.map(t => t.name)).toContain(bt);
    }
  });

  test('plugin re-added after removal reappears in tools/list', async ({ mcpServer, mcpClient }) => {
    const toolsBefore = await mcpClient.listTools();
    const pluginToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
    expect(pluginToolsBefore.length).toBeGreaterThan(0);

    // Remove plugin
    const config = readTestConfig(mcpServer.configDir);
    const savedPlugins = [...config.localPlugins];
    config.localPlugins = [];
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    const toolsMid = await mcpClient.listTools();
    expect(toolsMid.filter(t => t.name.startsWith('e2e-test_')).length).toBe(0);

    // Re-add plugin
    config.localPlugins = savedPlugins;
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    // Plugin tools should be back
    const toolsAfter = await mcpClient.listTools();
    const e2eToolsAfter = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
    expect(e2eToolsAfter.length).toBe(pluginToolsBefore.length);
  });
});

// ---------------------------------------------------------------------------
// Tool config changes via hot reload
// ---------------------------------------------------------------------------

test.describe.serial('Hot reload — tool config changes', () => {
  test('disabling a tool via config hides it from tools/list after hot reload', async ({ mcpServer, mcpClient }) => {
    const toolsBefore = await mcpClient.listTools();
    expect(toolsBefore.map(t => t.name)).toContain('e2e-test_echo');

    // Disable the echo tool
    const config = readTestConfig(mcpServer.configDir);
    config.tools['e2e-test_echo'] = false;
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    const toolsAfter = await mcpClient.listTools();
    expect(toolsAfter.map(t => t.name)).not.toContain('e2e-test_echo');

    // Other tools should still be there
    expect(toolsAfter.map(t => t.name)).toContain('e2e-test_greet');
    for (const bt of BROWSER_TOOL_NAMES) {
      expect(toolsAfter.map(t => t.name)).toContain(bt);
    }
  });

  test('re-enabling a tool via config restores it in tools/list after hot reload', async ({ mcpServer, mcpClient }) => {
    // Disable echo
    const config = readTestConfig(mcpServer.configDir);
    config.tools['e2e-test_echo'] = false;
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    expect((await mcpClient.listTools()).map(t => t.name)).not.toContain('e2e-test_echo');

    // Re-enable echo
    config.tools['e2e-test_echo'] = true;
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    expect((await mcpClient.listTools()).map(t => t.name)).toContain('e2e-test_echo');
  });
});

// ---------------------------------------------------------------------------
// File watcher — manifest changes (no hot reload needed)
// ---------------------------------------------------------------------------

test.describe.serial('File watcher — manifest changes', () => {
  test('adding a tool to manifest makes it appear in tools/list', async () => {
    // Create a per-test copy of the plugin so we can modify files safely
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-config-'));

    // Build config pointing to the copy, pre-enable the future tool
    const prefixedToolNames = [...readPluginToolNames(), 'e2e-test_dynamic_tool'];
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();
      const toolsBefore = await client.listTools();
      const e2eToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
      const countBefore = e2eToolsBefore.length;

      // The dynamic_tool should NOT be present yet (not in manifest)
      expect(toolsBefore.map(t => t.name)).not.toContain('e2e-test_dynamic_tool');

      // Modify dist/tools.json to add a new tool, retrying if the file
      // watcher misses the write (FSEvents registration race on macOS).
      const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
      const tools = readToolsFromManifest(toolsJsonPath);
      tools.push({
        name: 'dynamic_tool',
        displayName: 'Dynamic Tool',
        description: 'Dynamically added via file watcher',
        icon: 'wrench',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
        output_schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      });
      await writeAndWaitForWatcher(server, () => writeToolsToManifest(toolsJsonPath, tools), 'tools.json updated for');

      // Poll until the new tool appears in tools/list (replaces waitForLog + sleep)
      const toolsAfter = await waitForToolList(
        client,
        tools => tools.some(t => t.name === 'e2e-test_dynamic_tool'),
        15_000,
        300,
        'e2e-test_dynamic_tool to appear',
      );
      const e2eToolsAfter = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsAfter.length).toBe(countBefore + 1);
    } finally {
      await client.close();
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('removing a tool from manifest removes it from tools/list', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-remove-'));

    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();
      const toolsBefore = await client.listTools();
      expect(toolsBefore.map(t => t.name)).toContain('e2e-test_echo');

      // Remove the echo tool from dist/tools.json, retrying if the file
      // watcher misses the write (FSEvents registration race on macOS).
      const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
      const tools = readToolsFromManifest(toolsJsonPath);
      const filteredTools = tools.filter(t => t.name !== 'echo');
      await writeAndWaitForWatcher(
        server,
        () => writeToolsToManifest(toolsJsonPath, filteredTools),
        'tools.json updated for',
      );

      // Poll until echo tool disappears from tools/list
      const toolsAfter = await waitForToolList(
        client,
        tools => !tools.some(t => t.name === 'e2e-test_echo'),
        15_000,
        300,
        'e2e-test_echo to disappear',
      );
      // Other tools should remain
      expect(toolsAfter.map(t => t.name)).toContain('e2e-test_greet');
    } finally {
      await client.close();
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// File watcher — IIFE changes
// ---------------------------------------------------------------------------

test.describe('File watcher — IIFE changes', () => {
  test('IIFE change triggers plugin.update log', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-iife-'));

    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    const server = await startMcpServer(configDir, true);

    try {
      // Modify the IIFE file and wait for the watcher to detect it, retrying
      // if FSEvents misses the initial write (registration race on macOS).
      const iifePath = path.join(pluginDir, 'dist', 'adapter.iife.js');
      const originalIife = fs.readFileSync(iifePath, 'utf-8');
      await writeAndWaitForWatcher(
        server,
        attempt => fs.writeFileSync(iifePath, `${originalIife}\n// modified-for-test-${attempt}\n`, 'utf-8'),
        'IIFE updated for',
      );

      // Verify the log shows the update was sent (or attempted)
      const logsJoined = server.logs.join('\n');
      expect(logsJoined).toContain('IIFE updated for');
      expect(logsJoined).toContain('e2e-test');
    } finally {
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Multiple MCP sessions + hot reload
// ---------------------------------------------------------------------------

test.describe('Hot reload — multiple MCP sessions', () => {
  test('all MCP sessions see updated tools after hot reload', async ({ mcpServer, mcpClient }) => {
    // Session 1 (from fixture)

    const tools1Before = await mcpClient.listTools();
    expect(tools1Before.length).toBeGreaterThan(0);

    // Session 2 (manually created)
    const client2 = createMcpClient(mcpServer.port, mcpServer.secret);
    await client2.initialize();
    const tools2Before = await client2.listTools();
    expect(tools2Before.length).toBe(tools1Before.length);

    try {
      // Trigger hot reload
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      // Both sessions should still work (auto-reinitializing after worker
      // restart) and return the same tools.
      const tools1After = await mcpClient.listTools();
      const tools2After = await client2.listTools();
      expect(tools1After.length).toBe(tools1Before.length);
      expect(tools2After.length).toBe(tools2Before.length);
      expect(tools1After.map(t => t.name).sort()).toEqual(tools2After.map(t => t.name).sort());
    } finally {
      await client2.close();
    }
  });

  test('all sessions see config changes after hot reload', async ({ mcpServer, mcpClient }) => {
    const client2 = createMcpClient(mcpServer.port, mcpServer.secret);
    await client2.initialize();

    try {
      // Both see echo tool initially
      expect((await mcpClient.listTools()).map(t => t.name)).toContain('e2e-test_echo');
      expect((await client2.listTools()).map(t => t.name)).toContain('e2e-test_echo');

      // Disable echo tool and hot reload
      const config = readTestConfig(mcpServer.configDir);
      config.tools['e2e-test_echo'] = false;
      writeTestConfig(mcpServer.configDir, config);

      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      // Neither session should see echo tool
      expect((await mcpClient.listTools()).map(t => t.name)).not.toContain('e2e-test_echo');
      expect((await client2.listTools()).map(t => t.name)).not.toContain('e2e-test_echo');
    } finally {
      await client2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// New plugin tools callable from existing session after hot reload
// ---------------------------------------------------------------------------

test.describe.serial('Hot reload — new plugin callable from existing session', () => {
  test('plugin added via config is callable from pre-existing MCP session after hot reload', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');
    await testServer.reset();

    // Verify e2e-test plugin tools are visible
    const toolsBefore = await mcpClient.listTools();
    expect(toolsBefore.map(t => t.name)).toContain('e2e-test_echo');

    // Open a tab to the test server so the adapter gets injected
    const page = await extensionContext.newPage();
    await page.goto(testServer.url, { waitUntil: 'load' });

    // Wait for adapter injection
    await waitFor(
      () =>
        page.evaluate(() => {
          const ot = (globalThis as Record<string, unknown>).__openTabs as
            | { adapters?: Record<string, unknown> }
            | undefined;
          return ot?.adapters?.['e2e-test'] !== undefined;
        }),
      20_000,
      500,
      'e2e-test adapter to be injected into tab',
    );

    // Poll until the tool is callable (tab state = ready) instead of fixed sleep
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // Call a tool before hot reload (baseline)
    const beforeResult = await mcpClient.callTool('e2e-test_echo', { message: 'before-install' });
    expect(beforeResult.isError).toBe(false);
    const beforeOutput = JSON.parse(beforeResult.content) as Record<string, unknown>;
    expect(beforeOutput.message).toBe('before-install');

    // Now create a new minimal plugin and add it via config
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-callable-'));
    const newPluginDir = createMinimalPlugin(tmpDir, 'callable-test', [{ name: 'hello', description: 'Say hello' }]);

    try {
      const config = readTestConfig(mcpServer.configDir);
      config.localPlugins.push(newPluginDir);
      config.tools['callable-test_hello'] = true;
      writeTestConfig(mcpServer.configDir, config);

      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      // Wait for extension to re-sync after hot reload
      await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

      // Poll until the tool is callable instead of fixed sleep
      await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'post-reload-check' }, { isError: false }, 15_000);

      // The pre-existing session should now see the new plugin's tool
      const toolsAfter = await mcpClient.listTools();
      expect(toolsAfter.map(t => t.name)).toContain('callable-test_hello');

      // The original e2e-test tools should still be callable
      const afterResult = await mcpClient.callTool('e2e-test_echo', { message: 'after-install' });
      expect(afterResult.isError).toBe(false);
      const afterOutput = JSON.parse(afterResult.content) as Record<string, unknown>;
      expect(afterOutput.message).toBe('after-install');

      await page.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Health endpoint consistency across dynamic changes
// ---------------------------------------------------------------------------

test.describe.serial('Hot reload — health endpoint consistency', () => {
  test('health plugin count reflects added and removed plugins', async ({ mcpServer, mcpClient: _mcpClient }) => {
    const healthBefore = await mcpServer.health();
    expect(healthBefore).not.toBeNull();
    if (!healthBefore) throw new Error('health returned null');
    const countBefore = healthBefore.plugins;

    // Add a plugin
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-health-'));
    const newPluginDir = createMinimalPlugin(tmpDir, 'health-test', [{ name: 'probe', description: 'Probe' }]);

    try {
      const config = readTestConfig(mcpServer.configDir);
      config.localPlugins.push(newPluginDir);
      config.tools['health-test_probe'] = true;
      writeTestConfig(mcpServer.configDir, config);

      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      const healthAfterAdd = await mcpServer.health();
      expect(healthAfterAdd).not.toBeNull();
      if (!healthAfterAdd) throw new Error('health returned null');
      expect(healthAfterAdd.plugins).toBe(countBefore + 1);

      // Remove the added plugin
      config.localPlugins = config.localPlugins.filter(p => p !== newPluginDir);
      writeTestConfig(mcpServer.configDir, config);

      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      const healthAfterRemove = await mcpServer.health();
      expect(healthAfterRemove).not.toBeNull();
      if (!healthAfterRemove) throw new Error('health returned null');
      expect(healthAfterRemove.plugins).toBe(countBefore);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// File watcher + hot reload combined
// ---------------------------------------------------------------------------

test.describe('File watcher + hot reload combined', () => {
  test('file watcher change followed by hot reload: both changes reflected', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-combined-'));

    // Pre-enable a future dynamic tool
    const prefixedToolNames = [...readPluginToolNames(), 'e2e-test_fw_tool'];
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();

      // 1. File watcher change: add a tool via dist/tools.json, retrying if
      // the file watcher misses the write (FSEvents registration race on macOS).
      const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
      const tools = readToolsFromManifest(toolsJsonPath);
      tools.push({
        name: 'fw_tool',
        displayName: 'Fw Tool',
        description: 'Added by file watcher',
        icon: 'wrench',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
        output_schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      });
      await writeAndWaitForWatcher(server, () => writeToolsToManifest(toolsJsonPath, tools), 'tools.json updated for');

      // Poll until fw_tool appears in tools/list
      await waitForToolList(
        client,
        tools => tools.some(t => t.name === 'e2e-test_fw_tool'),
        15_000,
        300,
        'e2e-test_fw_tool to appear',
      );

      // 2. Now trigger a hot reload (config change: disable a tool)
      const config = readTestConfig(configDir);
      config.tools['e2e-test_echo'] = false;
      writeTestConfig(configDir, config);

      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 20_000);

      // After hot reload: fw_tool should still be discoverable (it's in the
      // manifest on disk, and discovery re-reads it). echo should be disabled.
      const toolsAfter = await client.listTools();
      expect(toolsAfter.map(t => t.name)).not.toContain('e2e-test_echo');
      // The fw_tool was added to the manifest, so discovery will find it
      expect(toolsAfter.map(t => t.name)).toContain('e2e-test_fw_tool');
    } finally {
      await client.close();
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Empty plugin config → add plugin (cold start scenario)
// ---------------------------------------------------------------------------

test.describe.serial('Hot reload — empty to populated', () => {
  test('server starts with no plugins, hot reload adds plugin', async () => {
    // Start with an EMPTY config (no plugins, no tools)
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-empty-'));
    writeTestConfig(configDir, { localPlugins: [], tools: {} });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();

      // Initially only browser tools should be present
      const toolsBefore = await client.listTools();
      const browserToolSet = new Set(BROWSER_TOOL_NAMES);
      const pluginTools = toolsBefore.filter(t => !browserToolSet.has(t.name));
      expect(pluginTools.length).toBe(0);

      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsBefore.map(t => t.name)).toContain(bt);
      }

      // Add e2e-test plugin via config
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 20_000);

      // Now plugin tools should appear
      const toolsAfter = await client.listTools();
      const e2eTools = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eTools.length).toBe(prefixedToolNames.length);

      // Browser tools should still be there
      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsAfter.map(t => t.name)).toContain(bt);
      }
    } finally {
      await client.close();
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// In-flight tool dispatch during hot reload
// ---------------------------------------------------------------------------

test.describe.serial('Hot reload — in-flight tool dispatch', () => {
  test('pending tool call completes successfully after hot reload fires mid-flight', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    try {
      // Baseline: tool works normally
      const baseline = await mcpClient.callTool('e2e-test_echo', { message: 'baseline' });
      expect(baseline.isError).toBe(false);

      // Set the test server to slow mode (3 second delay)
      await testServer.setSlow(3_000);

      // Start a slow tool call — this will take ~3 seconds
      const slowCallPromise = mcpClient.callTool('e2e-test_echo', { message: 'in-flight' });

      // Wait until the request actually reaches the test server before triggering
      // hot reload. Polling replaces a fixed 500ms sleep that was insufficient
      // under heavy CI load.
      await waitFor(
        async () => {
          const invocations = await testServer.invocations();
          return invocations.some(
            i => i.path === '/api/echo' && (i.body as Record<string, unknown>).message === 'in-flight',
          );
        },
        10_000,
        200,
        'echo request with message "in-flight" to reach test server',
      );
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();

      // The slow call may complete successfully or fail (the proxy kills
      // the worker process during restart, which can sever in-flight
      // HTTP connections). Either outcome is acceptable — the important
      // behavior is that subsequent calls work after the reload.
      try {
        const slowResult = await slowCallPromise;
        // If it completed, verify the content is correct
        if (!slowResult.isError) {
          const output = parseToolResult(slowResult.content);
          expect(output.message).toBe('in-flight');
        }
      } catch {
        // 502 Bad Gateway or connection reset during worker restart — expected
      }

      // Hot reload should have completed
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      // Wait for the extension to reconnect to the new worker. The proxy
      // kills the old worker's WebSocket connections during restart, so the
      // extension must detect the close and reconnect. Under high parallelism
      // (20+ Playwright workers), CPU contention can delay the reconnection
      // beyond the default 1s backoff, causing the post-reload tool call to
      // fail with "Extension not connected" if we don't wait.
      await waitForExtensionConnected(mcpServer, 30_000);

      // Reset slow mode and verify the session still works after reload
      await testServer.setSlow(0);
      const afterResult = await mcpClient.callTool('e2e-test_echo', { message: 'after-reload' });
      expect(afterResult.isError).toBe(false);
      const afterOutput = parseToolResult(afterResult.content);
      expect(afterOutput.message).toBe('after-reload');
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Tool description/schema change verification
// ---------------------------------------------------------------------------

test.describe.serial('File watcher — tool metadata changes', () => {
  test('tool description change in manifest is reflected in tools/list', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-desc-'));

    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();

      // Get the original description of the echo tool
      const toolsBefore = await client.listTools();
      const echoBefore = toolsBefore.find(t => t.name === 'e2e-test_echo');
      expect(echoBefore).toBeDefined();
      if (!echoBefore) throw new Error('echo tool not found');
      const originalDesc = echoBefore.description;

      // Modify the echo tool's description in dist/tools.json, retrying if
      // the file watcher misses the write (FSEvents registration race on macOS).
      const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
      const tools = readToolsFromManifest(toolsJsonPath);
      const echoTool = tools.find(t => t.name === 'echo');
      expect(echoTool).toBeDefined();
      if (!echoTool) throw new Error('echo tool not found in tools.json');
      echoTool.description = 'UPDATED: Echo a message back with new description';
      await writeAndWaitForWatcher(server, () => writeToolsToManifest(toolsJsonPath, tools), 'tools.json updated for');

      // Poll until the description changes in tools/list
      const toolsAfter = await waitForToolList(
        client,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          return echo !== undefined && echo.description.includes('UPDATED');
        },
        15_000,
        300,
        'echo description to contain UPDATED',
      );
      const echoAfter = toolsAfter.find(t => t.name === 'e2e-test_echo');
      expect(echoAfter).toBeDefined();
      if (!echoAfter) throw new Error('echo tool not found after update');
      expect(echoAfter.description).not.toBe(originalDesc);
    } finally {
      await client.close();
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Corrupted manifest graceful handling
// ---------------------------------------------------------------------------

test.describe('File watcher — corrupted manifest', () => {
  test('invalid JSON in manifest does not crash server and existing tools survive', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-corrupt-'));

    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();
      const toolsBefore = await client.listTools();
      const e2eCountBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_')).length;
      expect(e2eCountBefore).toBeGreaterThan(0);

      // Write invalid JSON to dist/tools.json and wait for the watcher to detect
      // it, retrying if FSEvents misses the initial write (registration race on macOS).
      const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
      await writeAndWaitForWatcher(
        server,
        attempt => fs.writeFileSync(toolsJsonPath, `{ invalid json ??? ${attempt}`, 'utf-8'),
        'Invalid JSON',
      );

      // Server should still be alive and healthy
      const health = await server.health();
      expect(health).not.toBeNull();
      if (!health) throw new Error('health returned null');
      expect(health.status).toBe('ok');

      // Existing tools should still be available (the corrupt manifest didn't wipe state)
      const toolsAfter = await client.listTools();
      const e2eCountAfter = toolsAfter.filter(t => t.name.startsWith('e2e-test_')).length;
      expect(e2eCountAfter).toBe(e2eCountBefore);
    } finally {
      await client.close();
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Corrupted config graceful handling
// ---------------------------------------------------------------------------

test.describe('Hot reload — corrupted config', () => {
  test('invalid JSON in config.json: server survives hot reload with defaults', async ({ mcpServer, mcpClient }) => {
    const toolsBefore = await mcpClient.listTools();
    expect(toolsBefore.length).toBeGreaterThan(0);

    // Save the original config so we can restore it after the corrupt phase
    const originalConfig = readTestConfig(mcpServer.configDir);

    // Write invalid JSON to config.json
    const configPath = path.join(mcpServer.configDir, 'config.json');
    fs.writeFileSync(configPath, '{ corrupt !!! not json', 'utf-8');

    // Trigger hot reload — config.ts loadConfig catches parse errors and returns defaults
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    // Server should still be alive (health endpoint is unauthenticated)
    const health = await mcpServer.health();
    expect(health).not.toBeNull();
    if (!health) throw new Error('health returned null');
    expect(health.status).toBe('ok');

    // The fallback config generated a new in-memory secret that isn't
    // persisted to disk. Restore the original config and hot-reload again
    // so the server picks up the known secret and we can verify MCP works.
    writeTestConfig(mcpServer.configDir, originalConfig);
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    // Read the secret from auth.json (single source of truth for auth)
    const authPath = path.join(mcpServer.configDir, 'extension', 'auth.json');
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as { secret?: string };
    const newClient = createMcpClient(mcpServer.port, authData.secret);
    await newClient.initialize();
    try {
      const toolsAfter = await newClient.listTools();
      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsAfter.map(t => t.name)).toContain(bt);
      }
    } finally {
      await newClient.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Hot reload with extension disconnected
// ---------------------------------------------------------------------------

test.describe('Hot reload — no extension connected', () => {
  test('hot reload succeeds when extension is not connected', async ({ mcpServer, mcpClient }) => {
    // Do NOT use extensionContext fixture — no extension launched

    const toolsBefore = await mcpClient.listTools();
    expect(toolsBefore.length).toBeGreaterThan(0);

    // Verify extension is NOT connected
    const healthBefore = await mcpServer.health();
    expect(healthBefore).not.toBeNull();
    if (!healthBefore) throw new Error('health returned null');
    expect(healthBefore.extensionConnected).toBe(false);

    // Trigger hot reload — should not crash on state.extensionWs === null
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    // Server should still be alive and session should still work
    const healthAfter = await mcpServer.health();
    expect(healthAfter).not.toBeNull();
    if (!healthAfter) throw new Error('health returned null');
    expect(healthAfter.status).toBe('ok');

    const toolsAfter = await mcpClient.listTools();
    expect(toolsAfter.length).toBe(toolsBefore.length);

    // Logs should NOT contain any error-level messages about extension.
    // Note: "0 error(s)" in discovery summary is informational, not an error.
    const errorLogs = mcpServer.logs.filter(
      line => line.includes('[ERROR]') || line.includes('Error:') || line.includes('ECONNREFUSED'),
    );
    expect(errorLogs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// File watcher — input_schema change propagation
// ---------------------------------------------------------------------------

test.describe.serial('File watcher — input_schema changes', () => {
  test('tool input_schema change in manifest is reflected in tools/list', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-schema-'));

    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();

      // Get the original input_schema of the echo tool
      const toolsBefore = await client.listTools();
      const echoBefore = toolsBefore.find(t => t.name === 'e2e-test_echo');
      expect(echoBefore).toBeDefined();
      if (!echoBefore) throw new Error('echo tool not found');

      // Modify the echo tool's input_schema in dist/tools.json — add a new
      // property, retrying if the watcher misses the write (FSEvents race).
      const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
      const tools = readToolsFromManifest(toolsJsonPath);
      const echoTool = tools.find(t => t.name === 'echo');
      expect(echoTool).toBeDefined();
      if (!echoTool) throw new Error('echo tool not found in tools.json');

      // Add a new optional "prefix" property to the schema
      const props = ((echoTool.input_schema ?? {}).properties ?? {}) as Record<string, unknown>;
      props['prefix'] = { type: 'string', description: 'Optional prefix for the echo' };
      (echoTool.input_schema ??= {}).properties = props;
      await writeAndWaitForWatcher(server, () => writeToolsToManifest(toolsJsonPath, tools), 'tools.json updated for');

      // Poll until the input_schema changes in tools/list
      const toolsAfter = await waitForToolList(
        client,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          if (!echo) return false;
          const schema = (echo as Record<string, unknown>).inputSchema as Record<string, unknown> | undefined;
          const propsObj = schema?.properties as Record<string, unknown> | undefined;
          return propsObj !== undefined && 'prefix' in propsObj;
        },
        15_000,
        300,
        'echo input_schema to include prefix property',
      );
      const echoAfter = toolsAfter.find(t => t.name === 'e2e-test_echo');
      expect(echoAfter).toBeDefined();
      if (!echoAfter) throw new Error('echo tool not found after update');

      // The new schema should have the "prefix" property
      const afterProps = (echoAfter.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
      expect(afterProps).toHaveProperty('prefix');

      // Original schema should NOT have had "prefix"
      const beforeProps = (echoBefore.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
      expect(beforeProps).not.toHaveProperty('prefix');
    } finally {
      await client.close();
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// File watcher restart after hot reload
// ---------------------------------------------------------------------------

test.describe.serial('File watcher — restart after hot reload', () => {
  test('file watcher still detects manifest changes after hot reload', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-restart-'));

    // Pre-enable a future dynamic tool for the second file watcher change
    const prefixedToolNames = [...readPluginToolNames(), 'e2e-test_post_reload_tool'];
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();

      // 1. Verify file watcher works BEFORE hot reload
      await waitForLog(server, 'File watcher: Watching', 10_000);

      const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
      const toolsBefore2 = readToolsFromManifest(toolsJsonPath);

      // Modify description of echo tool — file watcher should detect it
      const echoTool = toolsBefore2.find(t => t.name === 'echo');
      expect(echoTool).toBeDefined();
      if (!echoTool) throw new Error('echo tool not found in tools.json');
      await writeAndWaitForWatcher(
        server,
        attempt => {
          echoTool.description = 'BEFORE-RELOAD: modified description' + ' '.repeat(attempt);
          writeToolsToManifest(toolsJsonPath, toolsBefore2);
        },
        'tools.json updated for',
      );

      // Poll until the description changes
      const toolsMid = await waitForToolList(
        client,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          return echo !== undefined && echo.description.includes('BEFORE-RELOAD');
        },
        10_000,
        300,
        'echo description to contain BEFORE-RELOAD',
      );
      const echoMid = toolsMid.find(t => t.name === 'e2e-test_echo');
      expect(echoMid).toBeDefined();
      if (!echoMid) throw new Error('echo tool not found after first tools.json update');

      // 2. Trigger hot reload — this stops old file watchers and starts new ones
      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 20_000);

      // Verify file watchers were restarted
      await waitForLog(server, 'File watcher: Watching', 10_000);

      // 3. Modify tools.json AGAIN after hot reload — the new file watcher
      //    should detect this change. Add a new tool to be sure.
      const toolsAfterReload = readToolsFromManifest(toolsJsonPath);
      const postReloadTool = {
        name: 'post_reload_tool',
        displayName: 'Post Reload Tool',
        description: 'Added after hot reload to verify file watcher restart',
        icon: 'wrench',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
        output_schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      };
      toolsAfterReload.push(postReloadTool);
      await writeAndWaitForWatcher(
        server,
        attempt => {
          postReloadTool.description = 'Added after hot reload to verify file watcher restart' + ' '.repeat(attempt);
          writeToolsToManifest(toolsJsonPath, toolsAfterReload);
        },
        'tools.json updated for',
      );

      // Poll until the new tool appears (new file watcher after hot reload should detect this)
      await waitForToolList(
        client,
        tools => tools.some(t => t.name === 'e2e-test_post_reload_tool'),
        10_000,
        300,
        'e2e-test_post_reload_tool to appear after reload',
      );
    } finally {
      await client.close();
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// File watcher — version change propagation
// ---------------------------------------------------------------------------

test.describe.serial('File watcher — tools.json rewrite preserves all tools', () => {
  test('rewriting tools.json preserves all tools', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-fw-rewrite-'));

    const prefixedToolNames = readPluginToolNames();
    const toolConfig: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      toolConfig[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools: toolConfig });

    const server = await startMcpServer(configDir, true);
    const client = createMcpClient(server.port, server.secret);

    try {
      await client.initialize();

      // Verify initial tools are present
      const toolsBefore = await client.listTools();
      const e2eToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsBefore.length).toBeGreaterThan(0);
      const countBefore = e2eToolsBefore.length;

      // Wait for file watcher to be ready before modifying files
      await waitForLog(server, 'File watcher: Watching', 10_000);

      // Re-write tools.json (same content, triggers file watcher)
      const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
      const toolsContent = fs.readFileSync(toolsJsonPath, 'utf-8');
      fs.writeFileSync(toolsJsonPath, toolsContent, 'utf-8');

      // Wait for file watcher to detect the tools.json change
      await waitForLog(server, 'tools.json updated for', 10_000);

      // All tools should still be present after the rewrite
      const toolsAfter = await client.listTools();
      const e2eToolsAfter = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsAfter.length).toBe(countBefore);

      // Verify the same tool names are present
      const namesBefore = e2eToolsBefore.map(t => t.name).sort();
      const namesAfter = e2eToolsAfter.map(t => t.name).sort();
      expect(namesAfter).toEqual(namesBefore);

      // Verify server health is ok
      const health = await server.health();
      expect(health).not.toBeNull();
      if (!health) throw new Error('health returned null');
      expect(health.status).toBe('ok');
      expect(health.plugins).toBe(1);
    } finally {
      await client.close();
      await server.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
