/**
 * Side panel group transition E2E tests — verify that plugin cards move
 * between the ready and not-connected sections when matching tabs open/close,
 * and that the accordion auto-collapses during transitions.
 *
 * The side panel renders two groups:
 *   1. Ready plugins — full opacity, at the top
 *   2. Not-connected plugins — opacity-70, below the "NOT CONNECTED" label
 *
 * When a plugin's tab state changes (e.g., from 'closed' to 'ready'), the
 * plugin card moves between groups with a fade animation. The
 * `useGroupTransitions` hook detects these transitions and applies animation
 * classes. The `collapseTransitioningItems` function auto-collapses any
 * expanded accordion items during a transition.
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
  startMcpServer,
  startTestServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import { openSidePanel, setupAdapterSymlink, waitForExtensionConnected, waitForLog } from './helpers.js';

/**
 * Locate the Accordion.Item wrapper div for a plugin card.
 *
 * Radix renders: div[data-state] > h3 > button[aria-expanded].
 * The opacity-70 class for not-ready plugins is on the outermost div[data-state]
 * (the Accordion.Item). This helper finds the trigger button first, then
 * navigates up to the Accordion.Item div via XPath ancestor traversal.
 */
const pluginAccordionItem = (sidePanel: Page, displayName: string) =>
  sidePanel
    .locator('button[aria-expanded]')
    .filter({ hasText: displayName })
    .locator('xpath=ancestor::div[@data-state][1]');

// ---------------------------------------------------------------------------
// Group transition tests
// ---------------------------------------------------------------------------

test.describe('Side panel group transitions', () => {
  test('plugin moves from NOT CONNECTED to ready group when matching tab opens', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-group-open-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: { 'e2e-test': { permission: 'auto' }, browser: { permission: 'auto' } },
    });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // Open side panel — plugin has no matching tab so it's in the not-connected group
      const sidePanel = await openSidePanel(context);
      await expect(sidePanel.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Verify "NOT CONNECTED" label is visible
      await expect(sidePanel.getByText('NOT CONNECTED')).toBeVisible({ timeout: 15_000 });

      // Verify the plugin card has reduced opacity (not-ready state).
      // The opacity-70 class is on the Accordion.Item div wrapping the trigger.
      const accordionItem = pluginAccordionItem(sidePanel, 'E2E Test');
      await expect(accordionItem).toHaveClass(/opacity-70/, { timeout: 10_000 });

      // Open a matching tab — adapter injects, plugin becomes ready
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });
      await waitForLog(server, 'tab.stateChanged: e2e-test → ready', 15_000);

      // Verify the plugin card no longer has reduced opacity (now in ready group).
      // After the transition animation completes, the Accordion.Item has no opacity class.
      await expect(accordionItem).not.toHaveClass(/opacity-70/, { timeout: 10_000 });

      await sidePanel.close();
      await appTab.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
