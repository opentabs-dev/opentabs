/**
 * Permission system E2E tests — verifies the 3-state (off/ask/auto) permission
 * model end-to-end:
 *
 *   - Tool with permission 'off': returns "currently disabled" error
 *   - Tool with permission 'ask': confirmation dialog appears, allow/deny flows
 *   - Tool with permission 'ask' + Always Allow: permission persists to 'auto'
 *   - Tool with permission 'auto': executes immediately without dialog
 *   - skipPermissions=true: ask→auto (executes), off stays off
 *   - Plugin-level permission: setting plugin to 'auto' makes all tools auto
 *   - Per-tool override: tool-level permission overrides plugin default
 *
 * These tests start the MCP server WITHOUT OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS and use
 * explicit plugin permission configs to exercise each permission state.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { test as base, expect } from '@playwright/test';
import type { McpClient, McpServer, TestServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createTestConfigDir,
  launchExtensionContext,
  readTestConfig,
  startMcpServer,
  startTestServer,
  symlinkCrossPlatform,
  writeTestConfig,
} from './fixtures.js';
import {
  openSidePanel,
  setupAdapterSymlink,
  waitFor,
  waitForExtensionConnected,
  waitForLog,
  waitForToolList,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Custom fixture — MCP server without skipPermissions
// ---------------------------------------------------------------------------

interface PermissionFixtures {
  /** MCP server started WITHOUT OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS. */
  mcpServer: McpServer;
  /** Controllable test web server (bound to 0.0.0.0 so 127.0.0.2 works). */
  testServer: TestServer;
  /** Chromium browser context with the extension loaded. */
  extensionContext: BrowserContext;
  /** MCP client pointed at this test's server. */
  mcpClient: McpClient;
}

const test = base.extend<PermissionFixtures>({
  mcpServer: async ({ browserName: _ }, use) => {
    const configDir = createTestConfigDir();
    // Start server with OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS set to empty string
    // to disable the bypass. The check is `=== '1'`, so '' disables it.
    const server = await startMcpServer(configDir, true, undefined, {
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '',
    });
    try {
      await use(server);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  },

  testServer: async ({ browserName: _ }, use) => {
    const srv = await startTestServer();
    try {
      await use(srv);
    } finally {
      await srv.kill();
    }
  },

  extensionContext: async ({ mcpServer }, use) => {
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(mcpServer.port, mcpServer.secret);
    setupAdapterSymlink(mcpServer.configDir, extensionDir);

    // Symlink auth.json so the extension copy always sees the latest secret.
    const serverAuthJson = path.join(mcpServer.configDir, 'extension', 'auth.json');
    const extensionAuthJson = path.join(extensionDir, 'auth.json');
    fs.rmSync(extensionAuthJson, { force: true });
    symlinkCrossPlatform(serverAuthJson, extensionAuthJson, 'file');

    await use(context);
    await context.close();
    try {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  },

  mcpClient: async ({ mcpServer }, use) => {
    const client = createMcpClient(mcpServer.port, mcpServer.secret);
    await client.initialize();
    await use(client);
    await client.close();
  },
});

// ---------------------------------------------------------------------------
// Helpers for confirmation dialog interaction
// ---------------------------------------------------------------------------

/**
 * Wait for the confirmation dialog to appear in the side panel.
 * The dialog uses role="dialog" (Radix Dialog).
 */
const waitForConfirmationDialog = async (sidePanel: Page, timeoutMs = 15_000): Promise<void> => {
  await sidePanel.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: timeoutMs });
};

/** Click the "Allow" button in the confirmation dialog. */
const clickAllow = async (sidePanel: Page): Promise<void> => {
  await waitForConfirmationDialog(sidePanel);
  await sidePanel.getByRole('button', { name: 'Allow' }).click();
};

/** Click the "Deny" button in the confirmation dialog. */
const clickDeny = async (sidePanel: Page): Promise<void> => {
  await waitForConfirmationDialog(sidePanel);
  await sidePanel.getByRole('button', { name: 'Deny' }).click();
};

/** Toggle the "Always allow this tool" switch and then click Allow. */
const clickAllowAlways = async (sidePanel: Page): Promise<void> => {
  await waitForConfirmationDialog(sidePanel);
  const toggle = sidePanel.getByRole('switch', { name: 'Always allow this tool' });
  await toggle.click();
  await sidePanel.getByRole('button', { name: 'Allow' }).click();
};

// ---------------------------------------------------------------------------
// Helper: get the background service worker
// ---------------------------------------------------------------------------

const getBackgroundWorker = async (context: BrowserContext, timeoutMs = 10_000): Promise<Worker> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sw of context.serviceWorkers()) {
      if (sw.url().includes('background')) return sw;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Could not find background service worker within ${timeoutMs}ms`);
};

const getBadgeText = (sw: Worker): Promise<string> => sw.evaluate(() => chrome.action.getBadgeText({}));

// ---------------------------------------------------------------------------
// Tests — Tool with permission 'off'
// ---------------------------------------------------------------------------

test.describe('Permission: off', () => {
  test('tool with permission off returns disabled error', async ({ mcpServer, mcpClient }) => {
    // Set browser tools to 'off' and trigger config rediscovery
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { ...config.permissions, browser: { permission: 'off' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    const result = await mcpClient.callTool('browser_list_tabs', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('currently disabled');
  });
});

// ---------------------------------------------------------------------------
// Tests — Tool with permission 'auto'
// ---------------------------------------------------------------------------

test.describe('Permission: auto', () => {
  test('tool with permission auto executes immediately without dialog', async ({
    mcpServer,
    extensionContext: _ctx,
    mcpClient,
  }) => {
    // Set browser tools to 'auto' permission
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'auto' } };
    writeTestConfig(mcpServer.configDir, config);

    // Trigger config reload
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // browser_list_tabs with 'auto' permission should execute without any dialog
    const result = await mcpClient.callTool('browser_list_tabs', {});
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — Confirmation dialog — Allow flow
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — Allow', () => {
  test('ask permission triggers dialog, Allow grants permission and tool completes', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    // Set browser tools to 'ask' permission
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sidePanel = await openSidePanel(extensionContext);

    // Call a browser tool with 'ask' permission. Concurrently, verify the
    // dialog appears with the correct tool and plugin info, then click Allow.
    const [result] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      (async () => {
        await waitForConfirmationDialog(sidePanel);
        const dialog = sidePanel.locator('[role="dialog"]');
        // Verify dialog shows tool name and "Approve Tool" header
        await expect(dialog.getByText('browser_list_tabs')).toBeVisible();
        await expect(dialog.getByText('Approve Tool')).toBeVisible();
        // Click Allow
        await sidePanel.getByRole('button', { name: 'Allow' }).click();
      })(),
    ]);

    expect(result.isError).toBe(false);
  });

  test('Allow does not persist — subsequent call triggers new dialog', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sidePanel = await openSidePanel(extensionContext);

    // First call: Allow
    const [firstResult] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      clickAllow(sidePanel),
    ]);
    expect(firstResult.isError).toBe(false);

    // Second call: Allow should NOT persist, new dialog should appear
    const [secondResult] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      clickAllow(sidePanel),
    ]);
    expect(secondResult.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Confirmation dialog — Deny flow
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — Deny', () => {
  test('Deny returns PERMISSION_DENIED error', async ({ mcpServer, extensionContext, mcpClient }) => {
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sidePanel = await openSidePanel(extensionContext);

    const [result] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      clickDeny(sidePanel),
    ]);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('denied by the user');
  });
});

// ---------------------------------------------------------------------------
// Tests — Confirmation dialog — Always Allow
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — Always Allow', () => {
  test('Always Allow persists permission to auto — subsequent call executes without dialog', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sidePanel = await openSidePanel(extensionContext);

    // First call: check Always Allow checkbox and click Allow
    const [firstResult] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      clickAllowAlways(sidePanel),
    ]);
    expect(firstResult.isError).toBe(false);

    // Second call: should execute immediately without any dialog because
    // Always Allow persisted the per-tool permission to 'auto'
    const secondResult = await mcpClient.callTool('browser_list_tabs', {}, { timeout: 10_000 });
    expect(secondResult.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — skipPermissions converts ask to auto but respects off
// ---------------------------------------------------------------------------

test.describe('skipPermissions bypass', () => {
  test('skipPermissions=true converts ask to auto (tool executes without prompt)', async () => {
    const configDir = createTestConfigDir();
    try {
      // Set browser permission to 'ask' — skipPermissions converts ask→auto
      const config = readTestConfig(configDir);
      config.permissions = { ...config.permissions, browser: { permission: 'ask' } };
      writeTestConfig(configDir, config);

      const server = await startMcpServer(configDir, true, undefined, {
        OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1',
      });
      try {
        const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
        setupAdapterSymlink(configDir, extensionDir);
        const serverAuthJson = path.join(configDir, 'extension', 'auth.json');
        const extensionAuthJson = path.join(extensionDir, 'auth.json');
        fs.rmSync(extensionAuthJson, { force: true });
        symlinkCrossPlatform(serverAuthJson, extensionAuthJson, 'file');

        try {
          await waitForExtensionConnected(server);
          await waitForLog(server, 'tab.syncAll received');

          const client = createMcpClient(server.port, server.secret);
          await client.initialize();
          try {
            // With skipPermissions, ask→auto so the tool executes without prompt
            const result = await client.callTool('browser_list_tabs', {});
            expect(result.isError).toBe(false);
          } finally {
            await client.close();
          }
        } finally {
          await context.close();
          try {
            fs.rmSync(cleanupDir, { recursive: true, force: true });
          } catch {
            // best-effort
          }
        }
      } finally {
        await server.kill();
      }
    } finally {
      cleanupTestConfigDir(configDir);
    }
  });

  test('skipPermissions=true with off permission still returns disabled error', async () => {
    const configDir = createTestConfigDir();
    try {
      // Set browser permission to 'off' — skipPermissions does NOT override off
      const config = readTestConfig(configDir);
      config.permissions = { ...config.permissions, browser: { permission: 'off' } };
      writeTestConfig(configDir, config);

      const server = await startMcpServer(configDir, true, undefined, {
        OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1',
      });
      try {
        const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
        setupAdapterSymlink(configDir, extensionDir);

        try {
          await waitForExtensionConnected(server);
          await waitForLog(server, 'tab.syncAll received');

          const client = createMcpClient(server.port, server.secret);
          await client.initialize();
          try {
            const result = await client.callTool('browser_list_tabs', {});
            expect(result.isError).toBe(true);
            expect(result.content).toContain('currently disabled');
          } finally {
            await client.close();
          }
        } finally {
          await context.close();
          try {
            fs.rmSync(cleanupDir, { recursive: true, force: true });
          } catch {
            // best-effort
          }
        }
      } finally {
        await server.kill();
      }
    } finally {
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — Plugin-level permission
// ---------------------------------------------------------------------------

test.describe('Plugin-level permission', () => {
  test('setting plugin to auto makes all its tools auto', async ({ mcpServer, extensionContext: _ctx, mcpClient }) => {
    // Set browser plugin to 'auto' — all browser tools should inherit 'auto'
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'auto' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Multiple browser tools should all work without confirmation
    const listResult = await mcpClient.callTool('browser_list_tabs', {});
    expect(listResult.isError).toBe(false);
  });

  test('per-tool override overrides plugin default', async ({ mcpServer, mcpClient }) => {
    // Set browser plugin to 'auto' but override browser_list_tabs to 'off'
    // Browser tool permission keys use the full prefixed name
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = {
      browser: {
        permission: 'auto',
        tools: { browser_list_tabs: 'off' },
      },
    };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    // Wait for tools/list to reflect the [Disabled] prefix
    await waitForToolList(
      mcpClient,
      tools => {
        const lt = tools.find(t => t.name === 'browser_list_tabs');
        return lt?.description?.startsWith('[Disabled]') ?? false;
      },
      10_000,
      300,
      'browser_list_tabs [Disabled] prefix after per-tool off',
    );

    // browser_list_tabs is overridden to 'off' — should return disabled error
    const listResult = await mcpClient.callTool('browser_list_tabs', {});
    expect(listResult.isError).toBe(true);
    expect(listResult.content).toContain('currently disabled');
  });
});

// ---------------------------------------------------------------------------
// Tests — Confirmation notification badge lifecycle
// ---------------------------------------------------------------------------

test.describe('Confirmation notification — badge lifecycle', () => {
  test('badge is set when confirmation is pending and clears after approval', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sw = await getBackgroundWorker(extensionContext);
    const sidePanel = await openSidePanel(extensionContext);

    // Badge should start empty
    const initialBadge = await getBadgeText(sw);
    expect(initialBadge).toBe('');

    // Trigger an 'ask' tool. The badge increments to "1" while pending.
    const [result] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      (async () => {
        await waitFor(async () => (await getBadgeText(sw)) === '1', 15_000, 200, 'badge text === "1"');
        await clickAllow(sidePanel);
        await waitFor(async () => (await getBadgeText(sw)) === '', 10_000, 200, 'badge text === ""');
      })(),
    ]);

    expect(result.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Late side panel open (confirmation request before panel open)
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — late side panel open', () => {
  test('confirmation dialog appears when side panel opens after request arrived', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sw = await getBackgroundWorker(extensionContext);

    // Do NOT open the side panel yet — the request arrives while panel is closed.
    const [result] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      (async () => {
        // Wait for badge to show the pending confirmation
        await waitFor(async () => (await getBadgeText(sw)) === '1', 15_000, 200, 'badge text === "1"');

        // Now open the side panel — it should hydrate the pending confirmation
        const sidePanel = await openSidePanel(extensionContext);
        await waitForConfirmationDialog(sidePanel);

        const dialog = sidePanel.locator('[role="dialog"]');
        await expect(dialog.getByText('browser_list_tabs')).toBeVisible();
        await expect(dialog.getByText('Approve Tool')).toBeVisible();

        await sidePanel.getByRole('button', { name: 'Allow' }).click();
      })(),
    ]);

    expect(result.isError).toBe(false);
    await waitFor(async () => (await getBadgeText(sw)) === '', 10_000, 200, 'badge text === ""');
  });
});

// ---------------------------------------------------------------------------
// Tests — Confirmation dialog — multiple pending confirmations
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — multiple pending', () => {
  test('prev/next navigation works with two concurrent ask confirmations', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sw = await getBackgroundWorker(extensionContext);
    const sidePanel = await openSidePanel(extensionContext);

    const [result1, result2] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 60_000 }),
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 60_000 }),
      (async () => {
        // Wait for badge to show '2' (both confirmations arrived)
        await waitFor(async () => (await getBadgeText(sw)) === '2', 15_000, 200, 'badge text === "2"');

        await waitForConfirmationDialog(sidePanel);
        const dialog = sidePanel.locator('[role="dialog"]');

        // Dialog should show '1 of 2'
        await expect(dialog.getByText('1 of 2')).toBeVisible();

        // Prev should be disabled at index 0, next should be enabled
        const prevBtn = dialog.getByRole('button', { name: 'prev' });
        const nextBtn = dialog.getByRole('button', { name: 'next' });
        await expect(prevBtn).toBeDisabled();
        await expect(nextBtn).toBeEnabled();

        // Navigate to second confirmation
        await nextBtn.click();
        await expect(dialog.getByText('2 of 2')).toBeVisible();
        await expect(prevBtn).toBeEnabled();
        await expect(nextBtn).toBeDisabled();

        // Navigate back to first
        await prevBtn.click();
        await expect(dialog.getByText('1 of 2')).toBeVisible();

        // Allow the first confirmation
        await sidePanel.getByRole('button', { name: 'Allow' }).click();

        // After allowing one, only 1 remains — no 'X of Y' counter shown
        await expect(dialog.getByText('of')).toBeHidden({ timeout: 5_000 });

        // Badge should show '1'
        await waitFor(async () => (await getBadgeText(sw)) === '1', 10_000, 200, 'badge text === "1"');

        // Allow the remaining confirmation
        await sidePanel.getByRole('button', { name: 'Allow' }).click();

        // Badge should clear
        await waitFor(async () => (await getBadgeText(sw)) === '', 10_000, 200, 'badge text === ""');
      })(),
    ]);

    expect(result1.isError).toBe(false);
    expect(result2.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Tool description prefixes in tools/list
// ---------------------------------------------------------------------------

test.describe('Tool description prefixes', () => {
  test('tools/list shows [Disabled] prefix for off tools and [Requires approval] for ask tools', async ({
    mcpServer,
    mcpClient,
  }) => {
    // Configure: browser_list_tabs=off, browser_screenshot_tab=ask, browser_open_tab=auto
    // Browser tool permission keys use the full prefixed name
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = {
      browser: {
        tools: {
          browser_list_tabs: 'off',
          browser_screenshot_tab: 'ask',
          browser_open_tab: 'auto',
        },
      },
    };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    const tools = await mcpClient.listTools();

    // All tools should always appear in the list (no filtering)
    const listTabs = tools.find(t => t.name === 'browser_list_tabs');
    const screenshot = tools.find(t => t.name === 'browser_screenshot_tab');
    const openTab = tools.find(t => t.name === 'browser_open_tab');

    if (!listTabs || !screenshot || !openTab) {
      throw new Error('Expected all tools to be present in tools/list');
    }

    // Verify description prefixes
    expect(listTabs.description).toMatch(/^\[Disabled\]/);
    expect(screenshot.description).toMatch(/^\[Requires approval\]/);
    expect(openTab.description).not.toMatch(/^\[/);
  });
});
