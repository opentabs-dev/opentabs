/**
 * Permission system E2E tests — verifies that the browser tool permission
 * tier system evaluates correctly:
 *
 *   - Observe-tier tools (e.g. browser_list_tabs) auto-allow without confirmation
 *   - Interact/sensitive-tier tools on non-trusted domains trigger confirmation
 *     and block until a human responds in the side panel
 *
 * These tests start the MCP server WITHOUT skipPermissions (overriding the
 * default E2E fixture that sets OPENTABS_SKIP_PERMISSIONS=1) and use
 * 127.0.0.2 as a non-trusted domain to exercise the confirmation flow.
 *
 * The default trustedDomains are ['localhost', '127.0.0.1'], so 127.0.0.2
 * is not trusted and interact/sensitive tools will require confirmation.
 */

import {
  createTestConfigDir,
  cleanupTestConfigDir,
  startMcpServer,
  startTestServer,
  launchExtensionContext,
  createMcpClient,
  readTestConfig,
  writeTestConfig,
  symlinkCrossPlatform,
} from './fixtures.js';
import {
  waitForExtensionConnected,
  waitForLog,
  openSidePanel,
  setupAdapterSymlink,
  waitFor,
  parseToolResult,
} from './helpers.js';
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { McpClient, McpServer, TestServer } from './fixtures.js';
import type { BrowserContext, Page, Worker } from '@playwright/test';

// ---------------------------------------------------------------------------
// Custom fixture — MCP server without skipPermissions
// ---------------------------------------------------------------------------

interface PermissionFixtures {
  /** MCP server started WITHOUT OPENTABS_SKIP_PERMISSIONS. */
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
    // Start server with OPENTABS_SKIP_PERMISSIONS set to empty string
    // to disable the bypass. The check is `=== '1'`, so '' disables it.
    const server = await startMcpServer(configDir, true, undefined, {
      OPENTABS_SKIP_PERMISSIONS: '',
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
// Tests
// ---------------------------------------------------------------------------

test.describe('Permission evaluation', () => {
  test('observe-tier tool (browser_list_tabs) succeeds without confirmation', async ({
    mcpServer,
    extensionContext: _ctx,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // browser_list_tabs is observe tier — should auto-allow even without
    // skipConfirmation, regardless of the domain.
    const result = await mcpClient.callTool('browser_list_tabs', {});
    expect(result.isError).toBe(false);
    // The result should contain a list of tabs (at least the blank tab)
    const parsed = JSON.parse(result.content) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  test('interact-tier tool on non-trusted domain triggers confirmation progress notification', async ({
    mcpServer,
    testServer,
    extensionContext: _ctx,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Open a tab on localhost (trusted domain) so browser_open_tab itself
    // auto-allows. We then navigate to 127.0.0.2 (non-trusted) to test the
    // confirmation flow on browser_navigate_tab specifically.
    const openResult = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(openResult.isError).toBe(false);
    const tabInfo = JSON.parse(openResult.content) as { id: number };
    const tabId = tabInfo.id;

    // Poll until the tab's page has finished loading (localhost is trusted so
    // browser_execute_script auto-allows even without skipConfirmation).
    await waitFor(
      async () => {
        try {
          const scriptResult = await mcpClient.callTool('browser_execute_script', {
            tabId,
            code: 'return document.readyState',
          });
          if (scriptResult.isError) return false;
          const data = parseToolResult(scriptResult.content);
          const value = data.value as Record<string, unknown> | undefined;
          return value?.value === 'complete';
        } catch {
          return false;
        }
      },
      10_000,
      300,
      `tab ${tabId} readyState === complete`,
    );

    // Call an interact-tier tool (browser_navigate_tab) to a non-trusted
    // domain (127.0.0.2). This should trigger the confirmation flow and
    // send a progress notification with 'approval' while waiting for
    // human response. The confirmation will time out after 30s, but we
    // use callToolWithProgress to capture the progress notification.
    const nonTrustedUrl = testServer.url.replace('localhost', '127.0.0.2');
    const result = await mcpClient.callToolWithProgress(
      'browser_navigate_tab',
      { tabId, url: `${nonTrustedUrl}/interactive` },
      { timeout: 35_000 },
    );

    // The tool should have either timed out (CONFIRMATION_TIMEOUT) or
    // returned an error since no one responded to the confirmation dialog.
    expect(result.isError).toBe(true);
    expect(result.content).toContain('CONFIRMATION_TIMEOUT');

    // The MCP client should have received a progress notification
    // mentioning "approval" while the tool was pending confirmation.
    expect(result.progressNotifications.length).toBeGreaterThanOrEqual(1);
    const approvalNotif = result.progressNotifications.find(n => n.message?.toLowerCase().includes('approval'));
    expect(approvalNotif).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Helpers for confirmation dialog interaction
// ---------------------------------------------------------------------------

/**
 * Wait for the confirmation dialog to appear in the side panel, then return
 * the locator for the dialog container (the element with role="alert").
 */
const waitForConfirmationDialog = async (sidePanel: Page, timeoutMs = 15_000): Promise<void> => {
  await sidePanel.locator('[role="alert"]').waitFor({ state: 'visible', timeout: timeoutMs });
};

/**
 * Click the "Allow Once" button in the confirmation dialog.
 */
const clickAllowOnce = async (sidePanel: Page): Promise<void> => {
  await waitForConfirmationDialog(sidePanel);
  await sidePanel.getByRole('button', { name: 'Allow Once' }).click();
};

/**
 * Click the "Deny" button in the confirmation dialog.
 */
const clickDeny = async (sidePanel: Page): Promise<void> => {
  await waitForConfirmationDialog(sidePanel);
  await sidePanel.getByRole('button', { name: 'Deny' }).click();
};

/**
 * Click the "Allow Always" dropdown and select "For this tool on this domain".
 */
const clickAllowAlwaysToolDomain = async (sidePanel: Page): Promise<void> => {
  await waitForConfirmationDialog(sidePanel);
  // Click the "Allow Always" dropdown trigger button
  await sidePanel.getByRole('button', { name: 'Allow Always' }).click();
  // Select the "For this tool on this domain" menu item
  await sidePanel.getByRole('menuitem', { name: 'For this tool on this domain' }).click();
};

// ---------------------------------------------------------------------------
// Confirmation dialog — Allow Once flow
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — Allow Once', () => {
  test('Allow Once grants permission and tool completes successfully', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Open the side panel so we can interact with the confirmation dialog.
    const sidePanel = await openSidePanel(extensionContext);

    // Build a non-trusted URL (127.0.0.2 is not in default trustedDomains).
    const nonTrustedUrl = testServer.url.replace('localhost', '127.0.0.2');

    // Call a sensitive-tier tool (browser_get_cookies) on a non-trusted domain.
    // This blocks waiting for confirmation. Concurrently, verify the dialog
    // shows the correct tool name and domain, then click "Allow Once".
    const [result] = await Promise.all([
      mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 35_000 }),
      (async () => {
        await waitForConfirmationDialog(sidePanel);
        // Verify the dialog displays the correct tool name and domain.
        const dialogEl = sidePanel.locator('[role="alert"]');
        await expect(dialogEl.getByText('browser_get_cookies')).toBeVisible();
        await expect(dialogEl.getByText('127.0.0.2', { exact: true })).toBeVisible();
        await expect(dialogEl.getByText('Approval Required')).toBeVisible();
        // Grant "Allow Once" to unblock the tool call.
        await sidePanel.getByRole('button', { name: 'Allow Once' }).click();
      })(),
    ]);

    // The tool should have completed successfully after the confirmation.
    expect(result.isError).toBe(false);
  });

  test('Allow Once does not persist — subsequent call triggers new confirmation dialog', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sidePanel = await openSidePanel(extensionContext);
    const nonTrustedUrl = testServer.url.replace('localhost', '127.0.0.2');

    // First call: grant "Allow Once" to complete the tool.
    const [firstResult] = await Promise.all([
      mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 35_000 }),
      clickAllowOnce(sidePanel),
    ]);
    expect(firstResult.isError).toBe(false);

    // Second call: "Allow Once" should NOT persist, so a new confirmation
    // dialog should appear. Grant it again to verify the full round-trip.
    const [secondResult] = await Promise.all([
      mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 35_000 }),
      clickAllowOnce(sidePanel),
    ]);
    expect(secondResult.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confirmation dialog — Deny flow
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — Deny', () => {
  test('Deny returns PERMISSION_DENIED error', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sidePanel = await openSidePanel(extensionContext);
    const nonTrustedUrl = testServer.url.replace('localhost', '127.0.0.2');

    // Call a sensitive-tier tool on a non-trusted domain. Concurrently,
    // click "Deny" in the confirmation dialog.
    const [result] = await Promise.all([
      mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 35_000 }),
      clickDeny(sidePanel),
    ]);

    // The tool should return an error with PERMISSION_DENIED.
    expect(result.isError).toBe(true);
    expect(result.content).toContain('PERMISSION_DENIED');
  });
});

// ---------------------------------------------------------------------------
// Confirmation dialog — Allow Always (tool_domain scope) session persistence
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — Allow Always', () => {
  test('Allow Always (tool_domain) grants permission and persists for session', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sidePanel = await openSidePanel(extensionContext);
    const nonTrustedUrl = testServer.url.replace('localhost', '127.0.0.2');

    // First call: click "Allow Always" → "For this tool on this domain"
    const [firstResult] = await Promise.all([
      mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 35_000 }),
      clickAllowAlwaysToolDomain(sidePanel),
    ]);

    // The tool should complete successfully.
    expect(firstResult.isError).toBe(false);

    // Second call: same tool, same domain — should succeed immediately
    // without triggering a new confirmation dialog because "Allow Always"
    // persists the permission for the session.
    const secondResult = await mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 10_000 });
    expect(secondResult.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trusted domain auto-allow — interact-tier tool on localhost
// ---------------------------------------------------------------------------

test.describe('Trusted domain auto-allow', () => {
  test('interact-tier tool on trusted domain (localhost) succeeds without confirmation', async ({
    mcpServer,
    testServer,
    extensionContext: _ctx,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Open a tab on the test server via localhost (a default trusted domain).
    const openResult = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(openResult.isError).toBe(false);
    const tabInfo = JSON.parse(openResult.content) as { id: number };
    const tabId = tabInfo.id;

    // Poll until the tab's page has finished loading (localhost is trusted so
    // browser_execute_script auto-allows even without skipConfirmation).
    await waitFor(
      async () => {
        try {
          const scriptResult = await mcpClient.callTool('browser_execute_script', {
            tabId,
            code: 'return document.readyState',
          });
          if (scriptResult.isError) return false;
          const data = parseToolResult(scriptResult.content);
          const value = data.value as Record<string, unknown> | undefined;
          return value?.value === 'complete';
        } catch {
          return false;
        }
      },
      10_000,
      300,
      `tab ${tabId} readyState === complete`,
    );

    // Call an interact-tier tool (browser_navigate_tab) on the trusted
    // domain. Even without skipConfirmation, trusted domains upgrade
    // 'ask' → 'allow', so this should succeed immediately.
    const result = await mcpClient.callTool(
      'browser_navigate_tab',
      { tabId, url: `${testServer.url}/interactive` },
      { timeout: 10_000 },
    );

    expect(result.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confirmation notification — badge lifecycle
// ---------------------------------------------------------------------------

/**
 * Get the extension's background service worker from the browser context.
 * Polls until it appears (MV3 service workers may not be ready immediately).
 */
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

/**
 * Read the extension badge text from the service worker context.
 * Returns the current badge text (e.g. "1", "2", or "" when cleared).
 */
const getBadgeText = (sw: Worker): Promise<string> => sw.evaluate(() => chrome.action.getBadgeText({}));

test.describe('Confirmation notification — badge lifecycle', () => {
  test('badge is set when confirmation is pending and clears after approval', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sw = await getBackgroundWorker(extensionContext);
    const nonTrustedUrl = testServer.url.replace('localhost', '127.0.0.2');

    // Open the side panel so it can receive the confirmation request.
    const sidePanel = await openSidePanel(extensionContext);

    // Badge should start empty.
    const initialBadge = await getBadgeText(sw);
    expect(initialBadge).toBe('');

    // Trigger a sensitive-tier tool on a non-trusted domain. The
    // confirmation request sets the badge to "1". Concurrently, wait for
    // the badge to appear, approve the dialog, then verify the badge clears.
    const [result] = await Promise.all([
      mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 35_000 }),
      (async () => {
        // Poll until badge text becomes "1" (confirmation is pending).
        await waitFor(async () => (await getBadgeText(sw)) === '1', 15_000, 200, 'badge text === "1"');

        // Approve the confirmation dialog.
        await clickAllowOnce(sidePanel);

        // Poll until badge text clears back to "" (confirmation resolved).
        await waitFor(async () => (await getBadgeText(sw)) === '', 10_000, 200, 'badge text === ""');
      })(),
    ]);

    // The tool should have completed successfully after approval.
    expect(result.isError).toBe(false);
  });

  test('no notification when side panel is already open before tool call', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sw = await getBackgroundWorker(extensionContext);
    const nonTrustedUrl = testServer.url.replace('localhost', '127.0.0.2');

    // Open the side panel BEFORE triggering the confirmation. When the
    // panel is open, syncConfirmationNotification() suppresses the Chrome
    // desktop notification (chrome.notifications.create is not called).
    // The badge still increments, but the user sees the dialog directly.
    const sidePanel = await openSidePanel(extensionContext);

    // Trigger a sensitive-tier tool on a non-trusted domain and approve
    // the confirmation concurrently. Verify the badge lifecycle works
    // correctly even when the desktop notification is suppressed.
    const [result] = await Promise.all([
      mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 35_000 }),
      clickAllowOnce(sidePanel),
    ]);

    // The tool should complete successfully.
    expect(result.isError).toBe(false);

    // Badge should be cleared after the confirmation is resolved.
    await waitFor(async () => (await getBadgeText(sw)) === '', 10_000, 200, 'badge text === ""');
  });
});

// ---------------------------------------------------------------------------
// Confirmation dialog — late side panel open (panel closed when request arrives)
// ---------------------------------------------------------------------------

test.describe('Confirmation dialog — late side panel open', () => {
  test('confirmation dialog appears when side panel opens after request arrived while closed', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const sw = await getBackgroundWorker(extensionContext);
    const nonTrustedUrl = testServer.url.replace('localhost', '127.0.0.2');

    // Do NOT open the side panel yet — the confirmation request should arrive
    // while the panel is closed, and be hydrated when the panel opens later.

    // Call a sensitive-tier tool on a non-trusted domain. This blocks waiting
    // for confirmation. Concurrently, poll for the badge, open the panel,
    // verify the dialog, and approve it.
    const [result] = await Promise.all([
      mcpClient.callTool('browser_get_cookies', { url: nonTrustedUrl }, { timeout: 35_000 }),
      (async () => {
        // Poll until badge text becomes "1" (confirmation arrived at background).
        await waitFor(async () => (await getBadgeText(sw)) === '1', 15_000, 200, 'badge text === "1"');

        // Now open the side panel — it should hydrate the pending confirmation
        // from bg:getFullState and show the dialog.
        const sidePanel = await openSidePanel(extensionContext);

        // Wait for the confirmation dialog to appear.
        await waitForConfirmationDialog(sidePanel);

        // Verify the dialog shows the correct tool name and domain.
        const dialogEl = sidePanel.locator('[role="alert"]');
        await expect(dialogEl.getByText('browser_get_cookies')).toBeVisible();
        await expect(dialogEl.getByText('127.0.0.2', { exact: true })).toBeVisible();

        // Approve the confirmation to unblock the tool call.
        await sidePanel.getByRole('button', { name: 'Allow Once' }).click();
      })(),
    ]);

    // The tool should have completed successfully after approval.
    expect(result.isError).toBe(false);

    // Badge should clear back to empty after confirmation is resolved.
    await waitFor(async () => (await getBadgeText(sw)) === '', 10_000, 200, 'badge text === ""');
  });
});

// ---------------------------------------------------------------------------
// browserToolPolicy — disabling a browser tool via configuration
// ---------------------------------------------------------------------------

test.describe('browserToolPolicy', () => {
  test('disabled tool is hidden from tools/list and returns error on call', async () => {
    const configDir = createTestConfigDir();
    try {
      // Write a config with browser_screenshot_tab explicitly disabled.
      const config = readTestConfig(configDir);
      const configWithPolicy = {
        ...config,
        browserToolPolicy: { browser_screenshot_tab: false },
      };
      writeTestConfig(configDir, configWithPolicy as typeof config);

      // Start the server (no extension needed — purely server-side test).
      const server = await startMcpServer(configDir, true);
      try {
        const client = createMcpClient(server.port, server.secret);
        await client.initialize();
        try {
          // Verify browser_screenshot_tab is absent from tools/list.
          const tools = await client.listTools();
          const screenshotTool = tools.find(t => t.name === 'browser_screenshot_tab');
          expect(screenshotTool).toBeUndefined();

          // Verify calling it directly returns an error.
          const result = await client.callTool('browser_screenshot_tab', { tabId: 1 });
          expect(result.isError).toBe(true);
          expect(result.content).toContain('disabled');
        } finally {
          await client.close();
        }
      } finally {
        await server.kill();
      }
    } finally {
      cleanupTestConfigDir(configDir);
    }
  });
});
