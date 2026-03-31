/**
 * Cross-system chaos stress tests — exercises real-world scenarios where an AI
 * agent (MCP client), a user (side panel), and the CLI (config changes) are all
 * active simultaneously. These are the highest-value stress tests because they
 * verify the platform handles concurrent cross-boundary interactions gracefully.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  cleanupTestConfigDir,
  createMcpClient,
  E2E_TEST_PLUGIN_DIR,
  expect,
  launchExtensionContext,
  startMcpServer,
  startTestServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  openSidePanel,
  openTestAppTab,
  selectPermission,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

/** Read the e2e-test plugin version from its package.json. */
const getPluginVersion = (): string => {
  const pkg = JSON.parse(fs.readFileSync(path.join(E2E_TEST_PLUGIN_DIR, 'package.json'), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
};

const tick = (ms = 100) => new Promise(r => setTimeout(r, ms));
const collectPageErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (err: Error) => errors.push(err.message));
  return errors;
};

test.describe('Cross-system stress tests', () => {
  test('MCP client tool call while side panel toggles permission', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cross-system-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
        browser: { permission: 'auto' },
      },
    });

    // Disable skipPermissions so permission selects are interactive
    const server = await startMcpServer(configDir, false, undefined, {
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '',
    });
    const mcpClient = createMcpClient(server.port, server.secret);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);
      await mcpClient.initialize();

      // Open test app tab and wait for adapter injection
      await openTestAppTab(context, testServer.url, server, testServer);

      // Wait until the e2e-test tools are callable
      await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'warmup' }, { isError: false }, 15_000);

      // Open side panel
      const sp = await openSidePanel(context);
      const pageErrors = collectPageErrors(sp);

      // Wait for plugin card to appear
      await expect(sp.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand e2e-test plugin card
      const e2eCard = sp.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await e2eCard.click();
      await tick(200);

      // Start a slow tool call (3s) via MCP client — do NOT await
      const slowCallPromise = mcpClient.callTool('e2e-test_slow_with_progress', {
        durationMs: 3000,
      });

      // While the slow call is running, toggle a DIFFERENT plugin's permission.
      // Toggling the browser tools permission is truly independent of the e2e-test
      // plugin's dispatch pipeline, so the in-flight slow call must be unaffected.
      await tick(300); // let the slow call get started
      await selectPermission(sp, 'Permission for browser tools', 'Off');
      await tick(200);
      await selectPermission(sp, 'Permission for browser tools', 'Auto');

      // Wait for the slow call to settle. Toggling the plugin permission to
      // 'Off' may cancel the in-flight call (plugin-level permission disables
      // all tools). The call may succeed if it completed before the toggle, or
      // fail if the toggle took effect mid-dispatch. Both outcomes are valid.
      const [slowResult] = await Promise.allSettled([slowCallPromise]);
      expect(slowResult.status).toBe('fulfilled');

      // Verify both permission selects show 'Auto' (browser was toggled back, e2e-test was never touched)
      const browserTrigger = sp.locator('[aria-label="Permission for browser tools"]');
      await expect(browserTrigger).toContainText('Auto', { timeout: 10_000 });
      const e2ePluginTrigger = sp.locator('[aria-label="Permission for e2e-test plugin"]');
      await expect(e2ePluginTrigger).toContainText('Auto', { timeout: 10_000 });

      // Verify mcpClient.listTools() shows echo tool enabled
      await expect
        .poll(
          async () => {
            const tools = await mcpClient.listTools();
            const echo = tools.find(t => t.name === 'e2e-test_echo');
            return echo !== undefined && !echo.description.startsWith('[Disabled]');
          },
          { timeout: 15_000, message: 'e2e-test_echo should not be disabled after permission toggle' },
        )
        .toBe(true);

      // Make a fresh echo call to verify the system is healthy
      const echoResult = await mcpClient.callTool('e2e-test_echo', { message: 'post-chaos' });
      expect(echoResult.isError).toBe(false);
      const parsed = JSON.parse(echoResult.content) as { message: string };
      expect(parsed.message).toBe('post-chaos');

      // Assert zero page errors
      expect(pageErrors).toEqual([]);

      await sp.close();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('CLI config change during active MCP dispatch', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cross-config-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
        browser: { permission: 'auto' },
      },
    });

    const server = await startMcpServer(configDir);
    const mcpClient = createMcpClient(server.port, server.secret);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    /** POST /reload with Bearer auth. */
    const postReload = async (): Promise<Response> => {
      const secret = server.secret ?? '';
      return fetch(`http://localhost:${String(server.port)}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      });
    };

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);
      await mcpClient.initialize();

      // Open test app tab and wait for adapter injection
      await openTestAppTab(context, testServer.url, server, testServer);

      // Wait until the e2e-test tools are callable
      await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'warmup' }, { isError: false }, 15_000);

      // Start 3 slow tool calls (5s each) — do NOT await
      const slowCalls = Array.from({ length: 3 }, () =>
        mcpClient.callTool('e2e-test_slow_with_progress', { durationMs: 5000 }),
      );

      // After 500ms, remove the plugin from config (simulating CLI `opentabs plugin remove`)
      await tick(500);
      writeTestConfig(configDir, {
        localPlugins: [],
        permissions: {
          browser: { permission: 'auto' },
        },
      });
      await postReload();

      // Let the slow calls settle — some/all may fail (plugin gone)
      const slowResults = await Promise.allSettled(slowCalls);

      let failCount = 0;
      for (const result of slowResults) {
        if (result.status === 'rejected') {
          failCount++;
        } else if (result.value.isError) {
          failCount++;
          // Any non-empty error is acceptable after plugin removal — the
          // wording varies by timing (dispatch cancelled, plugin not found, etc.)
          expect(result.value.content.length).toBeGreaterThan(0);
        }
      }
      // At least one call MUST have failed — proving the plugin removal took effect
      expect(failCount).toBeGreaterThanOrEqual(1);

      // Verify server health is ok after the disruption
      const health = await server.health();
      expect(health).not.toBeNull();
      expect(health?.status).toBe('ok');

      // Restore config with the plugin
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
          browser: { permission: 'auto' },
        },
      });
      await postReload();

      // Wait for the plugin to be rediscovered and adapter re-injected
      await server.waitForHealth(h => h.plugins >= 1, 15_000);

      // Reopen a test app tab so the adapter gets injected fresh
      await openTestAppTab(context, testServer.url, server, testServer);

      // Verify fresh echo call succeeds (system recovered)
      await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'post-config-chaos' }, { isError: false }, 20_000);
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('Side panel search while MCP client installs plugin', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    // Start with NO plugins — only browser tools will be visible
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cross-search-'));
    writeTestConfig(configDir, {
      localPlugins: [],
      permissions: {
        browser: { permission: 'auto' },
      },
    });

    const server = await startMcpServer(configDir);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    /** POST /reload with Bearer auth. */
    const postReload = async (): Promise<Response> => {
      const secret = server.secret ?? '';
      return fetch(`http://localhost:${String(server.port)}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      });
    };

    try {
      await waitForExtensionConnected(server);
      // No plugins installed yet, so tab.syncAll may not arrive. Wait for
      // the sync.full message that confirms the extension received the registry.
      await waitForLog(server, 'sync.full', 15_000);

      // Open side panel
      const sp = await openSidePanel(context);
      const pageErrors = collectPageErrors(sp);

      // Verify connected state — browser tools card should be visible (always present)
      await expect(sp.getByText('Browser')).toBeVisible({ timeout: 30_000 });

      // Verify e2e-test plugin is NOT visible (no plugins installed)
      await expect(sp.getByText('E2E Test')).not.toBeVisible();

      // Type 'test' in the search input while no plugins are installed
      const searchInput = sp.locator('input[placeholder="Search plugins and tools..."]');
      await searchInput.fill('test');
      await tick(300);

      // While search is active, add the e2e-test plugin via config + POST /reload
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
          browser: { permission: 'auto' },
        },
      });
      await postReload();

      // Wait for the server to rediscover the plugin
      await server.waitForHealth(h => h.plugins >= 1, 15_000);

      // The side panel should receive a plugins.changed notification and refresh.
      // Since 'test' matches 'E2E Test', the search results should show the plugin.
      await expect(sp.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Clear search by clicking the clear button
      const clearButton = sp.locator('button[aria-label="Clear search"]');
      await clearButton.click();

      // Verify search input is empty
      await expect(searchInput).toHaveValue('');

      // Verify E2E Test plugin card is visible in the full (unfiltered) list
      await expect(sp.getByText('E2E Test')).toBeVisible({ timeout: 10_000 });

      // Assert zero page errors
      expect(pageErrors).toEqual([]);

      await sp.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('Full system stress: 3 MCP clients + side panel + config changes simultaneously', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cross-full-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
        browser: { permission: 'auto' },
      },
    });

    // Disable skipPermissions so side panel permission selects are interactive
    const server = await startMcpServer(configDir, false, undefined, {
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '',
    });
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    const client1 = createMcpClient(server.port, server.secret);
    const client2 = createMcpClient(server.port, server.secret);
    const client3 = createMcpClient(server.port, server.secret);

    /** POST /reload with Bearer auth. */
    const postReload = async (): Promise<Response> => {
      const secret = server.secret ?? '';
      return fetch(`http://localhost:${String(server.port)}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      });
    };

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // Open test app tab and wait for adapter injection
      await openTestAppTab(context, testServer.url, server, testServer);

      // Initialize all 3 MCP clients
      await client1.initialize();
      await client2.initialize();
      await client3.initialize();

      // Warm up: verify echo tool is callable
      await waitForToolResult(client1, 'e2e-test_echo', { message: 'warmup' }, { isError: false }, 15_000);

      // Open side panel and collect page errors
      const sp = await openSidePanel(context);
      const pageErrors = collectPageErrors(sp);

      // Wait for plugin card to appear
      await expect(sp.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand e2e-test plugin card
      const e2eCard = sp.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await e2eCard.click();
      await tick(200);

      // Find the theme toggle button
      const themeToggle = sp.locator('button[aria-label="Toggle theme"]');

      // --- Run all chaos streams concurrently for ~5 seconds ---

      // Stream 1-3: 3 MCP clients each making 10 echo calls with 500ms spacing
      const clientLoop = async (client: ReturnType<typeof createMcpClient>, prefix: string) => {
        const results: Array<{ content: string; isError: boolean }> = [];
        let errorCount = 0;
        for (let i = 0; i < 10; i++) {
          try {
            const r = await client.callTool('e2e-test_echo', { message: `${prefix}${i}` });
            results.push(r);
            if (r.isError) errorCount++;
          } catch (err) {
            errorCount++;
            console.log(`${prefix}: call ${i} error: ${String(err).slice(0, 80)}`);
          }
          await tick(500);
        }
        console.log(`${prefix}: ${errorCount} errors during chaos`);
        return results;
      };

      // Stream 4: Side panel interactions — toggle theme + expand/collapse cards
      const sidePanelLoop = async () => {
        for (let i = 0; i < 5; i++) {
          // Toggle theme
          if (await themeToggle.isVisible()) {
            await themeToggle.click().catch(() => {});
          }
          await tick(400);

          // Collapse and re-expand the e2e-test card
          const card = sp.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
          if (await card.isVisible().catch(() => false)) {
            await card.click().catch(() => {});
            await tick(200);
            await card.click().catch(() => {});
          }
          await tick(400);
        }
      };

      // Stream 5: Config mutation — remove plugin, reload, wait, restore, reload
      const configLoop = async () => {
        await tick(1000); // let clients get some calls in first

        // Remove the plugin
        writeTestConfig(configDir, {
          localPlugins: [],
          permissions: {
            browser: { permission: 'auto' },
          },
        });
        await postReload();

        await tick(1000); // let the removal propagate

        // Restore the plugin
        writeTestConfig(configDir, {
          localPlugins: [absPluginPath],
          permissions: {
            'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
            browser: { permission: 'auto' },
          },
        });
        await postReload();
      };

      // Launch all 5 streams concurrently
      await Promise.allSettled([
        clientLoop(client1, 'c1-'),
        clientLoop(client2, 'c2-'),
        clientLoop(client3, 'c3-'),
        sidePanelLoop(),
        configLoop(),
      ]);

      // --- Verify system survived the chaos ---

      // 1. Server health is ok
      const health = await server.health();
      expect(health).not.toBeNull();
      expect(health?.status).toBe('ok');

      // 2. Wait for plugin to be rediscovered (config was restored)
      await server.waitForHealth(h => h.plugins >= 1, 15_000);

      // 3. Open a fresh tab for adapter re-injection (existing tab may have lost adapter)
      await openTestAppTab(context, testServer.url, server, testServer);

      // 4. ALL 3 MCP clients must recover after chaos — not just 1
      const recoveryResults = await Promise.allSettled([
        waitForToolResult(client1, 'e2e-test_echo', { message: 'recovery-1' }, { isError: false }, 20_000),
        waitForToolResult(client2, 'e2e-test_echo', { message: 'recovery-2' }, { isError: false }, 20_000),
        waitForToolResult(client3, 'e2e-test_echo', { message: 'recovery-3' }, { isError: false }, 20_000),
      ]);
      for (const [i, result] of recoveryResults.entries()) {
        expect(result.status, `client ${i + 1} failed to recover after chaos`).toBe('fulfilled');
      }

      // 5. Side panel shows the e2e-test plugin (config was restored)
      await expect(sp.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 6. Zero JS errors on side panel
      expect(pageErrors).toEqual([]);

      await sp.close();
    } finally {
      await client1.close().catch(() => {});
      await client2.close().catch(() => {});
      await client3.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('Multiple MCP sessions calling tools concurrently', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cross-sessions-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
        browser: { permission: 'auto' },
      },
    });

    const server = await startMcpServer(configDir);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    const client1 = createMcpClient(server.port, server.secret);
    const client2 = createMcpClient(server.port, server.secret);
    const client3 = createMcpClient(server.port, server.secret);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // Open test app tab and wait for adapter injection
      await openTestAppTab(context, testServer.url, server, testServer);

      // Initialize all 3 clients
      await client1.initialize();
      await client2.initialize();
      await client3.initialize();

      // Verify session IDs are all different
      expect(client1.sessionId).toBeTruthy();
      expect(client2.sessionId).toBeTruthy();
      expect(client3.sessionId).toBeTruthy();
      expect(client1.sessionId).not.toBe(client2.sessionId);
      expect(client1.sessionId).not.toBe(client3.sessionId);
      expect(client2.sessionId).not.toBe(client3.sessionId);

      // Warm up: verify dispatch pipeline is ready for ALL clients
      await waitForToolResult(client1, 'e2e-test_echo', { message: 'warmup-1' }, { isError: false }, 15_000);
      await waitForToolResult(client2, 'e2e-test_echo', { message: 'warmup-2' }, { isError: false }, 15_000);
      await waitForToolResult(client3, 'e2e-test_echo', { message: 'warmup-3' }, { isError: false }, 15_000);

      // Fire 15 calls in parallel (5 per client, each with unique prefix)
      const makeEchoCalls = (client: ReturnType<typeof createMcpClient>, prefix: string) =>
        Array.from({ length: 5 }, (_, i) => client.callTool('e2e-test_echo', { message: `${prefix}${i}` }));

      const allCalls = [
        ...makeEchoCalls(client1, 'c1-'),
        ...makeEchoCalls(client2, 'c2-'),
        ...makeEchoCalls(client3, 'c3-'),
      ];

      const results = await Promise.all(allCalls);

      // All 15 calls should succeed
      for (const result of results) {
        expect(result.isError).toBe(false);
      }

      // Parse results and verify each client's results contain only its own prefix
      const c1Results = results.slice(0, 5);
      const c2Results = results.slice(5, 10);
      const c3Results = results.slice(10, 15);

      for (const r of c1Results) {
        const parsed = JSON.parse(r.content) as { message: string };
        expect(parsed.message).toMatch(/^c1-/);
      }
      for (const r of c2Results) {
        const parsed = JSON.parse(r.content) as { message: string };
        expect(parsed.message).toMatch(/^c2-/);
      }
      for (const r of c3Results) {
        const parsed = JSON.parse(r.content) as { message: string };
        expect(parsed.message).toMatch(/^c3-/);
      }
    } finally {
      await client1.close().catch(() => {});
      await client2.close().catch(() => {});
      await client3.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
