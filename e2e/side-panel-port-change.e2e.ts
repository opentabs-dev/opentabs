/**
 * Side panel port change E2E test — verifies the footer's NumberStepper
 * port editor triggers a WebSocket reconnect to a different MCP server.
 *
 * Flow: change port in side panel → chrome.storage.local update →
 * port-changed message → offscreen reconnects WebSocket to new port.
 *
 * Uses manual setup (two MCP servers on different ports sharing the same
 * config dir / auth secret) instead of the standard extensionContext fixture.
 */

import {
  test,
  expect,
  startMcpServer,
  launchExtensionContext,
  cleanupTestConfigDir,
  readPluginToolNames,
  writeTestConfig,
  E2E_TEST_PLUGIN_DIR,
} from './fixtures.js';
import { waitForExtensionConnected, openSidePanel, setupAdapterSymlink } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from './fixtures.js';

test.describe('Side panel port change', () => {
  test('changing port in footer reconnects extension to new server', async () => {
    // 1. Set up config dir with e2e-test plugin
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-port-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    // 2. Start server A on an ephemeral port
    const serverA = await startMcpServer(configDir, true);
    let serverB: McpServer | null = null;

    const { context, cleanupDir, extensionDir } = await launchExtensionContext(serverA.port, serverA.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 3. Wait for extension to connect to server A
      await waitForExtensionConnected(serverA);

      // 4. Open side panel and verify connected state (plugin card visible)
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 5. Start server B on a different ephemeral port (same config dir → same auth secret)
      serverB = await startMcpServer(configDir, true);

      // 6. Change the port in the side panel's NumberStepper to server B's port.
      // The NumberStepper commits its value on blur or Enter key.
      const portInput = sidePanelPage.getByLabel('Server port');
      await portInput.fill(String(serverB.port));
      await portInput.press('Enter');

      // 7. Wait for extension to connect to server B
      await waitForExtensionConnected(serverB, 45_000);

      // 8. Verify server B /health shows extensionConnected === true
      const healthB = await serverB.health();
      expect(healthB).not.toBeNull();
      if (!healthB) throw new Error('healthB returned null');
      expect(healthB.extensionConnected).toBe(true);

      await sidePanelPage.close();
    } finally {
      await context.close();
      await serverA.kill();
      if (serverB) await serverB.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
