/**
 * Side panel accordion state persistence E2E tests — verify that expanding
 * plugin cards and the browser tools card, closing the side panel, and
 * reopening it shows the cards still expanded (persisted via
 * chrome.storage.session).
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

test.describe('Side panel accordion state persistence', () => {
  test('expanded cards remain expanded after side panel close and reopen', async () => {
    // 1. Standard setup: MCP server + extension context
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-accordion-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect, open side panel
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      const sidePanelPage = await openSidePanel(context);

      // 3. Verify plugin card is visible and collapsed
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await expect(pluginCard).toHaveAttribute('aria-expanded', 'false');

      // 4. Verify browser tools card is visible and collapsed
      const browserCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await expect(browserCard).toHaveAttribute('aria-expanded', 'false');

      // 5. Expand both cards
      await pluginCard.click();
      await expect(pluginCard).toHaveAttribute('aria-expanded', 'true');
      await browserCard.click();
      await expect(browserCard).toHaveAttribute('aria-expanded', 'true');

      // 6. Close the side panel
      await sidePanelPage.close();

      // 7. Small delay to ensure chrome.storage.session writes complete
      await new Promise(r => setTimeout(r, 500));

      // 8. Reopen the side panel
      const sidePanelPage2 = await openSidePanel(context);

      // 9. Verify the cards are still expanded after the fresh page load
      await expect(sidePanelPage2.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });
      const pluginCard2 = sidePanelPage2.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await expect(pluginCard2).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
      const browserCard2 = sidePanelPage2.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await expect(browserCard2).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });

      // 10. Collapse the plugin card and verify it persists as collapsed
      await pluginCard2.click();
      await expect(pluginCard2).toHaveAttribute('aria-expanded', 'false');
      await sidePanelPage2.close();
      await new Promise(r => setTimeout(r, 500));

      const sidePanelPage3 = await openSidePanel(context);
      await expect(sidePanelPage3.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });
      const pluginCard3 = sidePanelPage3.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await expect(pluginCard3).toHaveAttribute('aria-expanded', 'false', { timeout: 10_000 });

      // Browser card should STILL be expanded (we only collapsed plugin)
      const browserCard3 = sidePanelPage3.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await expect(browserCard3).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });

      await sidePanelPage3.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Side panel accordion stress', () => {
  const tick = (ms = 100) => new Promise(r => setTimeout(r, ms));
  const collectPageErrors = (page: Page): string[] => {
    const errors: string[] = [];
    page.on('pageerror', (err: Error) => errors.push(err.message));
    return errors;
  };

  test('rapid accordion toggling does not break card state', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-accordion-stress-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      const sidePanelPage = await openSidePanel(context);
      const pageErrors = collectPageErrors(sidePanelPage);

      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      const e2eCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      const browserCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });

      // Rapid toggle e2e card 20x
      for (let i = 0; i < 20; i++) {
        await e2eCard.click();
        await tick(30);
      }

      // Rapid toggle browser card 20x
      for (let i = 0; i < 20; i++) {
        await browserCard.click();
        await tick(30);
      }

      // Interleave: alternate e2e and browser cards 10x
      for (let i = 0; i < 10; i++) {
        await e2eCard.click();
        await browserCard.click();
        await tick(30);
      }

      // After the storm, ensure both cards are still functional.
      // Check aria-expanded and expand if needed.
      const e2eExpanded = await e2eCard.getAttribute('aria-expanded');
      if (e2eExpanded !== 'true') {
        await e2eCard.click();
      }
      await expect(e2eCard).toHaveAttribute('aria-expanded', 'true');

      const browserExpanded = await browserCard.getAttribute('aria-expanded');
      if (browserExpanded !== 'true') {
        await browserCard.click();
      }
      await expect(browserCard).toHaveAttribute('aria-expanded', 'true');

      // Verify Echo tool visible in expanded e2e card
      await expect(sidePanelPage.getByText('Echo', { exact: true })).toBeVisible({ timeout: 5_000 });

      // Verify a browser tool display name visible in expanded browser card
      await expect(sidePanelPage.getByText('List Tabs', { exact: true })).toBeVisible({ timeout: 5_000 });

      expect(pageErrors).toEqual([]);

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
