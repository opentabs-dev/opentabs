/**
 * Side panel theme toggle E2E tests — verify that clicking the theme toggle
 * button switches between light and dark mode, checking the html element's
 * class and the button's aria-label / icon.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  cleanupTestConfigDir,
  E2E_TEST_PLUGIN_DIR,
  expect,
  launchExtensionContext,
  readPluginToolNames,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import { openSidePanel, setupAdapterSymlink, waitForExtensionConnected, waitForLog } from './helpers.js';

test.describe('Side panel theme toggle', () => {
  test('clicking theme toggle switches between light and dark mode', async () => {
    // 1. Standard setup: MCP server + extension context
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-theme-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect, open side panel
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      const sidePanel = await openSidePanel(context);

      // 3. Verify initial state — light mode (no 'dark' class on html)
      const html = sidePanel.locator('html');
      await expect(html).not.toHaveClass(/dark/);

      // 4. Footer shows Moon icon button with aria-label 'Switch to dark mode'
      const darkToggle = sidePanel.getByLabel('Switch to dark mode');
      await expect(darkToggle).toBeVisible();

      // 5. Click the toggle — should switch to dark mode
      await darkToggle.click();

      // 6. Verify dark mode: html has 'dark' class
      await expect(html).toHaveClass(/dark/);

      // 7. Footer now shows Sun icon button with aria-label 'Switch to light mode'
      const lightToggle = sidePanel.getByLabel('Switch to light mode');
      await expect(lightToggle).toBeVisible();

      // 8. Click again — should switch back to light mode
      await lightToggle.click();

      // 9. Verify light mode restored: no 'dark' class, Moon icon visible
      await expect(html).not.toHaveClass(/dark/);
      await expect(sidePanel.getByLabel('Switch to dark mode')).toBeVisible();

      await sidePanel.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('theme persists across side panel close and reopen', async () => {
    // 1. Standard setup: MCP server + extension context
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-theme-persist-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect, open side panel
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      let sidePanel = await openSidePanel(context);

      // 3. Switch to dark mode
      const darkToggle = sidePanel.getByLabel('Switch to dark mode');
      await expect(darkToggle).toBeVisible();
      await darkToggle.click();
      await expect(sidePanel.locator('html')).toHaveClass(/dark/);

      // 4. Close side panel and wait for storage write
      await sidePanel.close();
      await new Promise(r => setTimeout(r, 500));

      // 5. Reopen — dark mode should persist
      sidePanel = await openSidePanel(context);
      await expect(sidePanel.locator('html')).toHaveClass(/dark/, { timeout: 5_000 });
      await expect(sidePanel.getByLabel('Switch to light mode')).toBeVisible();

      // 6. Switch back to light mode
      await sidePanel.getByLabel('Switch to light mode').click();
      await expect(sidePanel.locator('html')).not.toHaveClass(/dark/);

      // 7. Close and reopen — light mode should persist
      await sidePanel.close();
      await new Promise(r => setTimeout(r, 500));

      sidePanel = await openSidePanel(context);
      await expect(sidePanel.locator('html')).not.toHaveClass(/dark/, { timeout: 5_000 });
      await expect(sidePanel.getByLabel('Switch to dark mode')).toBeVisible();

      await sidePanel.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Side panel theme stress', () => {
  const tick = (ms = 100) => new Promise(r => setTimeout(r, ms));
  const collectPageErrors = (page: Page): string[] => {
    const errors: string[] = [];
    page.on('pageerror', (err: Error) => errors.push(err.message));
    return errors;
  };

  test('rapid theme toggle 20x does not crash and state is deterministic', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-theme-stress-rapid-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, false);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      const sidePanel = await openSidePanel(context);
      const pageErrors = collectPageErrors(sidePanel);

      // Wait for UI to render
      await expect(sidePanel.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Record initial theme state
      const html = sidePanel.locator('html');
      const initialClasses = await html.getAttribute('class');
      const startedDark = initialClasses?.includes('dark') ?? false;

      // Locate theme toggle (works for either light or dark current state)
      const themeToggle = sidePanel.locator('[aria-label="Switch to dark mode"], [aria-label="Switch to light mode"]');

      // Rapid toggle 20x with 30ms between each
      for (let i = 0; i < 20; i++) {
        await themeToggle.click();
        await tick(30);
      }

      // After 20 clicks (even number), theme should be same as start
      if (startedDark) {
        await expect(html).toHaveClass(/dark/);
      } else {
        await expect(html).not.toHaveClass(/dark/);
      }

      // Plugin card should still be visible (no crash)
      await expect(sidePanel.getByText('E2E Test')).toBeVisible();

      expect(pageErrors).toEqual([]);

      await sidePanel.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('theme persists after fast close/reopen', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-theme-stress-persist-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, false);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      let sidePanel = await openSidePanel(context);
      const pageErrors = collectPageErrors(sidePanel);

      // Wait for UI to render
      await expect(sidePanel.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Record initial theme
      const html = sidePanel.locator('html');
      const initialClasses = await html.getAttribute('class');
      const startedDark = initialClasses?.includes('dark') ?? false;

      // Toggle theme once
      const themeToggle = sidePanel.locator('[aria-label="Switch to dark mode"], [aria-label="Switch to light mode"]');
      await themeToggle.click();

      // Verify theme actually changed
      if (startedDark) {
        await expect(html).not.toHaveClass(/dark/);
      } else {
        await expect(html).toHaveClass(/dark/);
      }

      // Close side panel quickly (within 100ms)
      await tick(100);
      await sidePanel.close();

      // Reopen and verify theme persisted
      sidePanel = await openSidePanel(context);

      const reopenedHtml = sidePanel.locator('html');
      if (startedDark) {
        // Was dark, toggled to light — light should persist
        await expect(reopenedHtml).not.toHaveClass(/dark/, { timeout: 5_000 });
      } else {
        // Was light, toggled to dark — dark should persist
        await expect(reopenedHtml).toHaveClass(/dark/, { timeout: 5_000 });
      }

      expect(pageErrors).toEqual([]);

      await sidePanel.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
