/**
 * Side panel server self-update UI E2E tests.
 *
 * Verifies:
 *   1. When a server update is available, the browser tools card icon shows
 *      a yellow dot indicator and the menu shows an "Update to vX.Y.Z" item
 *   2. When no update is available, no dot or menu item appears
 *   3. Clearing the update via /__test/simulate-server-update removes the indicator
 *   4. Clicking Update triggers the server.selfUpdate request; on failure an error alert appears
 *   5. After server disconnect and reconnect (without injected update), the dot clears
 *   6. Double-clicking Update only triggers one update request
 *
 * These tests use the dev-only test endpoints:
 *   - POST /__test/set-server-update: inject fake serverUpdate data
 *   - POST /__test/simulate-server-update: clear serverUpdate data
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupTestConfigDir,
  expect,
  launchExtensionContext,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import { openSidePanel, setupAdapterSymlink, waitForExtensionConnected } from './helpers.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Inject fake serverUpdate data into the MCP server via the dev-only test endpoint. */
const setServerUpdate = async (
  port: number,
  secret: string,
  serverUpdate: { latestVersion: string; updateCommand: string } | null,
): Promise<void> => {
  const res = await fetch(`http://localhost:${port}/__test/set-server-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ serverUpdate }),
  });
  if (!res.ok) throw new Error(`setServerUpdate failed: ${res.status} ${await res.text()}`);
};

/** Clear serverUpdate data via the dev-only test endpoint. */
const simulateServerUpdate = async (port: number, secret: string): Promise<void> => {
  const res = await fetch(`http://localhost:${port}/__test/simulate-server-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`simulateServerUpdate failed: ${res.status} ${await res.text()}`);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Side panel — server update indicator', () => {
  test('update dot and menu item appear when update is available, disappear when cleared', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-server-update-'));
    writeTestConfig(configDir, { localPlugins: [] });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);

      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=Browser')).toBeVisible({ timeout: 30_000 });

      // Locate the browser tools menu button and its update dot
      const menuButton = sidePanelPage.locator('[aria-label="Browser tools options"]');
      await expect(menuButton).toBeVisible();

      // The update dot is inside the accordion trigger's relative wrapper around PluginIcon
      const browserToolsTrigger = sidePanelPage.locator('button[data-radix-collection-item]', { hasText: 'Browser' });
      const updateDot = browserToolsTrigger.locator('div.rounded-full');

      // --- Verify: no update dot when no update is available ---
      await expect(updateDot).not.toBeVisible();

      // Open menu and verify no Update menu item
      await menuButton.click();
      const updateMenuItem = sidePanelPage.locator('[role="menuitem"]', { hasText: /^Update to v/ });
      await expect(updateMenuItem).not.toBeVisible();
      await sidePanelPage.keyboard.press('Escape');

      // --- Inject fake server update data ---
      const secret = server.secret;
      expect(secret).toBeTruthy();
      if (!secret) throw new Error('Server secret is required');

      await setServerUpdate(server.port, secret, {
        latestVersion: '99.0.0',
        updateCommand: 'npm install -g @opentabs-dev/cli',
      });

      // --- Verify: update dot now visible ---
      await expect(updateDot).toBeVisible({ timeout: 10_000 });

      // Open menu and verify Update menu item appears with correct version
      await menuButton.click();
      await expect(updateMenuItem).toBeVisible({ timeout: 5_000 });
      await expect(updateMenuItem).toContainText('Update to v99.0.0');
      await sidePanelPage.keyboard.press('Escape');

      // --- Clear server update and verify dot disappears ---
      await simulateServerUpdate(server.port, secret);

      await expect(updateDot).not.toBeVisible({ timeout: 10_000 });

      // Open menu and verify Update menu item is gone
      await menuButton.click();
      await expect(updateMenuItem).not.toBeVisible();
    } finally {
      await context.close();
      await server.kill();
      cleanupTestConfigDir(configDir);
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });

  test('no update dot when no serverUpdate is set', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-server-update-'));
    writeTestConfig(configDir, { localPlugins: [] });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);

      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=Browser')).toBeVisible({ timeout: 30_000 });

      const browserToolsTrigger = sidePanelPage.locator('button[data-radix-collection-item]', { hasText: 'Browser' });
      const updateDot = browserToolsTrigger.locator('div.rounded-full');
      await expect(updateDot).not.toBeVisible();

      // Open menu and verify no Update menu item
      const menuButton = sidePanelPage.locator('[aria-label="Browser tools options"]');
      await menuButton.click();
      const updateMenuItem = sidePanelPage.locator('[role="menuitem"]', { hasText: /^Update to v/ });
      await expect(updateMenuItem).not.toBeVisible();
    } finally {
      await context.close();
      await server.kill();
      cleanupTestConfigDir(configDir);
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});

test.describe('Side panel — server update click behavior', () => {
  test('clicking Update shows error alert when server.selfUpdate fails', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-server-update-'));
    writeTestConfig(configDir, { localPlugins: [] });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);

      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=Browser')).toBeVisible({ timeout: 30_000 });

      const secret = server.secret;
      expect(secret).toBeTruthy();
      if (!secret) throw new Error('Server secret is required');

      // Inject fake server update
      await setServerUpdate(server.port, secret, {
        latestVersion: '99.0.0',
        updateCommand: 'npm install -g @opentabs-dev/cli',
      });

      // Wait for update dot to appear
      const browserToolsTrigger = sidePanelPage.locator('button[data-radix-collection-item]', { hasText: 'Browser' });
      const updateDot = browserToolsTrigger.locator('div.rounded-full');
      await expect(updateDot).toBeVisible({ timeout: 10_000 });

      // Open menu and click Update
      const menuButton = sidePanelPage.locator('[aria-label="Browser tools options"]');
      await menuButton.click();
      const updateMenuItem = sidePanelPage.locator('[role="menuitem"]', { hasText: /^Update to v/ });
      await expect(updateMenuItem).toBeVisible({ timeout: 5_000 });
      await updateMenuItem.click();

      // The server.selfUpdate handler will fail because this is a dev install
      // (serverSourcePath does not contain 'node_modules'). Verify error alert.
      const errorAlert = sidePanelPage.locator('[role="alert"]');
      await expect(errorAlert).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
      await server.kill();
      cleanupTestConfigDir(configDir);
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});

test.describe('Side panel — server disconnect clears update indicator', () => {
  test('after server kill and restart, update dot is absent', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-server-update-'));
    writeTestConfig(configDir, { localPlugins: [] });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    // Track the port so we can restart on the same port for reconnection
    const serverPort = server.port;
    let server2: Awaited<ReturnType<typeof startMcpServer>> | undefined;

    try {
      await waitForExtensionConnected(server);

      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=Browser')).toBeVisible({ timeout: 30_000 });

      const secret = server.secret;
      expect(secret).toBeTruthy();
      if (!secret) throw new Error('Server secret is required');

      // Inject fake server update
      await setServerUpdate(server.port, secret, {
        latestVersion: '99.0.0',
        updateCommand: 'npm install -g @opentabs-dev/cli',
      });

      // Verify update dot is visible
      const browserToolsTrigger = sidePanelPage.locator('button[data-radix-collection-item]', { hasText: 'Browser' });
      const updateDot = browserToolsTrigger.locator('div.rounded-full');
      await expect(updateDot).toBeVisible({ timeout: 10_000 });

      // Kill the server
      await server.kill();

      // Verify disconnected state
      await expect(sidePanelPage.locator('text=Cannot Reach MCP Server')).toBeVisible({ timeout: 30_000 });

      // Start a new server on the same port and configDir (no serverUpdate injected)
      server2 = await startMcpServer(configDir, true, serverPort);

      // Wait for extension to reconnect
      await waitForExtensionConnected(server2);

      // Verify the side panel reconnects and shows Browser tools
      await expect(sidePanelPage.locator('text=Browser')).toBeVisible({ timeout: 30_000 });

      // Verify no update dot (new server has no serverUpdate)
      await expect(updateDot).not.toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
      await server.kill().catch(() => {});
      await server2?.kill();
      cleanupTestConfigDir(configDir);
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});

test.describe('stress — server update double-click protection', () => {
  test('double-clicking Update only executes one update', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-server-update-'));
    writeTestConfig(configDir, { localPlugins: [] });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    const pageErrors: Error[] = [];

    try {
      await waitForExtensionConnected(server);

      const sidePanelPage = await openSidePanel(context);
      sidePanelPage.on('pageerror', err => pageErrors.push(err));

      await expect(sidePanelPage.locator('text=Browser')).toBeVisible({ timeout: 30_000 });

      const secret = server.secret;
      expect(secret).toBeTruthy();
      if (!secret) throw new Error('Server secret is required');

      // Inject fake server update
      await setServerUpdate(server.port, secret, {
        latestVersion: '99.0.0',
        updateCommand: 'npm install -g @opentabs-dev/cli',
      });

      // Wait for update dot
      const browserToolsTrigger = sidePanelPage.locator('button[data-radix-collection-item]', { hasText: 'Browser' });
      const updateDot = browserToolsTrigger.locator('div.rounded-full');
      await expect(updateDot).toBeVisible({ timeout: 10_000 });

      // Open menu and click Update
      const menuButton = sidePanelPage.locator('[aria-label="Browser tools options"]');
      await menuButton.click();
      const updateMenuItem = sidePanelPage.locator('[role="menuitem"]', { hasText: /^Update to v/ });
      await expect(updateMenuItem).toBeVisible({ timeout: 5_000 });
      await updateMenuItem.click();

      // Immediately try to re-open menu and click Update again
      await menuButton.click();
      const secondUpdateVisible = await updateMenuItem.isVisible().catch(() => false);
      if (secondUpdateVisible) {
        await updateMenuItem.click().catch(() => {});
      }

      // Dismiss menu if still open
      await sidePanelPage.keyboard.press('Escape');

      // Wait for the error alert (update fails in dev mode)
      const errorAlert = sidePanelPage.locator('[role="alert"]');
      await expect(errorAlert).toBeVisible({ timeout: 30_000 });

      // Only one error alert should appear (confirms only one update ran)
      await expect(errorAlert).toHaveCount(1);

      // Zero page errors
      expect(pageErrors).toHaveLength(0);
    } finally {
      await context.close();
      await server.kill();
      cleanupTestConfigDir(configDir);
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});
