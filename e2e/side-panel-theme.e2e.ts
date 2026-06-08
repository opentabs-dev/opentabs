/**
 * Side panel theme toggle E2E tests — verify that clicking the theme toggle
 * button switches between light and dark mode, checking the html element's
 * class and the button's aria-label / icon.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      await waitForLog(server, 'plugin(s) mapped', 15_000);

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
      await waitForLog(server, 'plugin(s) mapped', 15_000);

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
