/**
 * Side panel accordion state persistence E2E tests — verify that expanding
 * plugin cards and the browser tools card, closing the side panel, and
 * reopening it shows the cards still expanded (persisted via
 * chrome.storage.session).
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
      await waitForLog(server, 'tab.syncAll received', 15_000);

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
