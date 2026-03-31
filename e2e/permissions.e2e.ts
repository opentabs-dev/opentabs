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
  openTestAppTab,
  setupAdapterSymlink,
  waitFor,
  waitForExtensionConnected,
  waitForLog,
  waitForToolList,
  waitForToolResult,
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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
          await waitForLog(server, 'plugin(s) mapped');

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
          await waitForLog(server, 'plugin(s) mapped');

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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
// Tests — Confirmation dialog — close/reopen persistence
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — close/reopen persistence', () => {
  test('dialog reappears after side panel close and reopen', async ({ mcpServer, extensionContext, mcpClient }) => {
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');

    let sidePanel = await openSidePanel(extensionContext);

    const [result] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 60_000 }),
      (async () => {
        // Wait for the dialog to appear
        await waitForConfirmationDialog(sidePanel);
        const dialog = sidePanel.locator('[role="dialog"]');
        await expect(dialog.getByText('browser_list_tabs')).toBeVisible();

        // Close the side panel (destroys React tree and all component state)
        await sidePanel.close();
        await new Promise(r => setTimeout(r, 500));

        // Reopen the side panel — it should hydrate pending confirmations from the background
        sidePanel = await openSidePanel(extensionContext);

        // Dialog should reappear with the same tool info
        await waitForConfirmationDialog(sidePanel, 20_000);
        const dialog2 = sidePanel.locator('[role="dialog"]');
        await expect(dialog2.getByText('browser_list_tabs')).toBeVisible();
        await expect(dialog2.getByText('Approve Tool')).toBeVisible();

        // Allow the tool to complete
        await sidePanel.getByRole('button', { name: 'Allow' }).click();
      })(),
    ]);

    expect(result.isError).toBe(false);
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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
// Tests — Confirmation dialog — dismiss resistance (Escape / outside click)
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — dismiss resistance', () => {
  test('Escape key and outside click do not dismiss the dialog', async ({ mcpServer, extensionContext, mcpClient }) => {
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { browser: { permission: 'ask' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const sidePanel = await openSidePanel(extensionContext);

    const [result] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      (async () => {
        await waitForConfirmationDialog(sidePanel);

        // Press Escape — dialog should stay open
        await sidePanel.keyboard.press('Escape');
        await expect(sidePanel.locator('[role="dialog"]')).toBeVisible({ timeout: 2_000 });

        // Click outside the dialog content (top-left corner, on the overlay)
        await sidePanel.mouse.click(5, 5);
        await expect(sidePanel.locator('[role="dialog"]')).toBeVisible({ timeout: 2_000 });

        // Dialog survived — Allow it to complete the test
        await sidePanel.getByRole('button', { name: 'Allow' }).click();
      })(),
    ]);

    expect(result.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Confirmation dialog — parameters display
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — parameters display', () => {
  test('dialog shows expandable parameters for tools with params', async ({
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
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const sidePanel = await openSidePanel(extensionContext);

    const [result] = await Promise.all([
      mcpClient.callTool('browser_open_tab', { url: 'https://example.com' }, { timeout: 35_000 }),
      (async () => {
        await waitForConfirmationDialog(sidePanel);
        const dialog = sidePanel.locator('[role="dialog"]');

        // Parameters summary should be visible
        const summary = dialog.getByText('Parameters');
        await expect(summary).toBeVisible();

        // Click to expand
        await summary.click();

        // Pre should show the JSON params
        const pre = dialog.locator('pre');
        await expect(pre).toBeVisible();
        const text = await pre.textContent();
        expect(text).toContain('https://example.com');

        await sidePanel.getByRole('button', { name: 'Allow' }).click();
      })(),
    ]);

    expect(result.isError).toBe(false);
  });

  test('dialog does not show Parameters section for tools without params', async ({
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
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const sidePanel = await openSidePanel(extensionContext);

    const [result] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
      (async () => {
        await waitForConfirmationDialog(sidePanel);
        const dialog = sidePanel.locator('[role="dialog"]');

        // Parameters section should NOT be present
        await expect(dialog.getByText('Parameters')).toBeHidden({ timeout: 2_000 });

        await sidePanel.getByRole('button', { name: 'Allow' }).click();
      })(),
    ]);

    expect(result.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Confirmation dialog — plugin tools (not just browser tools)
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — plugin tools', () => {
  test('Allow completes plugin tool and returns correct result', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // Start with e2e-test at 'auto' so the plugin can become ready
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');
    await testServer.reset();

    await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // Switch e2e-test permission to 'ask'
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = {
      ...config.permissions,
      'e2e-test': { permission: 'ask' },
      browser: { permission: 'auto' },
    };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const sidePanel = await openSidePanel(extensionContext);

    const [result] = await Promise.all([
      mcpClient.callTool('e2e-test_echo', { message: 'hello from plugin' }, { timeout: 35_000 }),
      (async () => {
        await waitForConfirmationDialog(sidePanel);
        const dialog = sidePanel.locator('[role="dialog"]');

        // Dialog shows the base tool name and plugin slug
        await expect(dialog.getByText('echo')).toBeVisible();
        await expect(dialog.getByText('e2e-test')).toBeVisible();
        await expect(dialog.getByText('Approve Tool')).toBeVisible();

        // Parameters should be visible (echo takes { message })
        const summary = dialog.getByText('Parameters');
        await expect(summary).toBeVisible();

        await sidePanel.getByRole('button', { name: 'Allow' }).click();
      })(),
    ]);

    expect(result.isError).toBe(false);
    expect(result.content).toContain('hello from plugin');
  });

  test('Deny returns PERMISSION_DENIED error for plugin tool', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // Start with e2e-test at 'auto' so the plugin can become ready
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');
    await testServer.reset();

    await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // Switch e2e-test permission to 'ask'
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = {
      ...config.permissions,
      'e2e-test': { permission: 'ask' },
      browser: { permission: 'auto' },
    };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const sidePanel = await openSidePanel(extensionContext);

    const [result] = await Promise.all([
      mcpClient.callTool('e2e-test_echo', { message: 'will be denied' }, { timeout: 35_000 }),
      (async () => {
        await waitForConfirmationDialog(sidePanel);
        await sidePanel.getByRole('button', { name: 'Deny' }).click();
      })(),
    ]);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('denied by the user');
  });
});

// ---------------------------------------------------------------------------
// Tests — Confirmation dialog — Always Allow switch reset
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — Always Allow switch reset', () => {
  test('Always Allow switch resets to unchecked after each Allow/Deny decision', async ({
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
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const sw = await getBackgroundWorker(extensionContext);
    const sidePanel = await openSidePanel(extensionContext);

    // Send two concurrent 'ask' tool calls
    const [result1, result2] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 60_000 }),
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 60_000 }),
      (async () => {
        // Wait for both confirmations to arrive
        await waitFor(async () => (await getBadgeText(sw)) === '2', 15_000, 200, 'badge text === "2"');

        await waitForConfirmationDialog(sidePanel);
        const dialog = sidePanel.locator('[role="dialog"]');
        const alwaysAllowSwitch = dialog.getByRole('switch', { name: 'Always allow this tool' });

        // Switch should start unchecked
        await expect(alwaysAllowSwitch).toHaveAttribute('data-state', 'unchecked');

        // Toggle the Always Allow switch ON
        await alwaysAllowSwitch.click();
        await expect(alwaysAllowSwitch).toHaveAttribute('data-state', 'checked');

        // Allow the first confirmation (with Always Allow toggled on)
        await sidePanel.getByRole('button', { name: 'Allow' }).click();

        // The switch should reset to unchecked for the second confirmation
        await waitForConfirmationDialog(sidePanel);
        const dialog2 = sidePanel.locator('[role="dialog"]');
        const alwaysAllowSwitch2 = dialog2.getByRole('switch', { name: 'Always allow this tool' });
        await expect(alwaysAllowSwitch2).toHaveAttribute('data-state', 'unchecked', { timeout: 5_000 });

        // Deny the second confirmation
        await sidePanel.getByRole('button', { name: 'Deny' }).click();
      })(),
    ]);

    expect(result1.isError).toBe(false);
    expect(result2.isError).toBe(true);
    expect(result2.content).toContain('denied by the user');
  });
});

// ---------------------------------------------------------------------------
// Tests — Badge count for multiple pending confirmations
// ---------------------------------------------------------------------------

test.describe('Confirmation notification — badge count for multiple pending', () => {
  test('badge shows correct count for multiple pending confirmations', async ({
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
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const sw = await getBackgroundWorker(extensionContext);
    const sidePanel = await openSidePanel(extensionContext);

    // Three concurrent 'ask' calls
    const [r1, r2, r3] = await Promise.all([
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 60_000 }),
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 60_000 }),
      mcpClient.callTool('browser_list_tabs', {}, { timeout: 60_000 }),
      (async () => {
        // Wait for badge to show '3' (all three confirmations arrived)
        await waitFor(async () => (await getBadgeText(sw)) === '3', 15_000, 200, 'badge text === "3"');

        // Allow first
        await waitForConfirmationDialog(sidePanel);
        await sidePanel.getByRole('button', { name: 'Allow' }).click();
        await waitFor(async () => (await getBadgeText(sw)) === '2', 10_000, 200, 'badge text === "2"');

        // Allow second
        await waitForConfirmationDialog(sidePanel);
        await sidePanel.getByRole('button', { name: 'Allow' }).click();
        await waitFor(async () => (await getBadgeText(sw)) === '1', 10_000, 200, 'badge text === "1"');

        // Allow third
        await waitForConfirmationDialog(sidePanel);
        await sidePanel.getByRole('button', { name: 'Allow' }).click();
        await waitFor(async () => (await getBadgeText(sw)) === '', 10_000, 200, 'badge text === ""');
      })(),
    ]);

    expect(r1.isError).toBe(false);
    expect(r2.isError).toBe(false);
    expect(r3.isError).toBe(false);
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

// ---------------------------------------------------------------------------
// Stress: Permission auto→off during in-flight call
// ---------------------------------------------------------------------------

test.describe('Permission change mid-flight — in-flight completes, next call disabled', () => {
  test('in-flight call completes after permission changed to off, next call returns disabled', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // e2e-test starts with permission 'auto' (from createTestConfigDir defaults).
    // Set up the test tab so plugin tools are callable.
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');
    await testServer.reset();

    const page = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // Fire a slow tool call (5s duration) — it passes the permission check at dispatch entry
    const slowCallPromise = mcpClient.callTool(
      'e2e-test_slow_with_progress',
      { durationMs: 5000, steps: 2 },
      { timeout: 30_000 },
    );

    // Give the call time to reach the extension and start executing before
    // changing permissions (dispatch is near-instant over WebSocket).
    await new Promise(r => setTimeout(r, 1_000));

    // Use POST /reload (config reload) instead of triggerHotReload (SIGUSR1)
    // because hot reload kills the worker process, which would interrupt the
    // in-flight slow call. Config reload re-reads config.json and updates
    // permissions in-place without restarting the worker.
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { ...config.permissions, 'e2e-test': { permission: 'off' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    const reloadRes = await fetch(`http://localhost:${mcpServer.port}/reload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mcpServer.secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(reloadRes.ok, `POST /reload failed: ${reloadRes.status}`).toBe(true);
    await waitForLog(mcpServer, 'Config reload complete', 15_000);

    // The in-flight call already passed the permission check before dispatch.
    // It MUST complete successfully — permission changes only affect NEW calls.
    const slowResult = await slowCallPromise;
    expect(slowResult.isError).not.toBe(true);

    // A subsequent call should be rejected with a 'disabled' or 'not been reviewed' message
    const rejectedResult = await mcpClient.callTool('e2e-test_echo', { message: 'should-fail' });
    expect(rejectedResult.isError).toBe(true);
    expect(
      rejectedResult.content.includes('currently disabled') || rejectedResult.content.includes('not been reviewed'),
      `expected 'currently disabled' or 'not been reviewed', got: ${rejectedResult.content}`,
    ).toBe(true);

    await page.close();
  });
});
