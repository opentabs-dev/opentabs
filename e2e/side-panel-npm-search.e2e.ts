/**
 * Side panel npm plugin E2E tests — verify the search → install → uninstall
 * flow for npm plugins through the side panel UI.
 *
 * The search and install tests depend on `npm search keywords:opentabs-plugin`
 * returning results, which requires the npm registry search index to include
 * @opentabs-dev packages. When the index is stale, those tests are skipped.
 *
 * The uninstall test pre-installs a plugin via `npm install -g` to avoid the
 * search dependency, then tests the side panel uninstall flow.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupTestConfigDir,
  createMcpClient,
  E2E_TEST_PLUGIN_DIR,
  expect,
  launchExtensionContext,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  npmSlackPluginHasArtifacts,
  openSidePanel,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
} from './helpers.js';

/**
 * Check if npm search can find opentabs plugins. Returns true if the npm
 * registry search index includes packages with the `opentabs-plugin` keyword.
 */
const npmSearchFindsPlugins = (): boolean => {
  try {
    const result = execSync('npm search "keywords:opentabs-plugin" --json', {
      encoding: 'utf8',
      timeout: 15_000,
    });
    const entries = JSON.parse(result.trim()) as unknown[];
    return entries.length > 0;
  } catch {
    return false;
  }
};

const searchAvailable = npmSearchFindsPlugins();
const slackArtifactsAvailable = npmSlackPluginHasArtifacts();

test.describe('Side panel npm search', () => {
  // These two tests require npm search to return opentabs plugin results.
  // The npm registry search index intermittently drops @opentabs-dev packages.
  test.describe('search-dependent tests', () => {
    test.skip(!searchAvailable, 'npm search index does not include opentabs-plugin packages');

    test('searches for plugins and shows results under Available section', async () => {
      test.slow();

      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-search-'));
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
      });

      const server = await startMcpServer(configDir, false);
      const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
      setupAdapterSymlink(configDir, extensionDir);

      try {
        await waitForExtensionConnected(server);

        const sidePanelPage = await openSidePanel(context);
        await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

        const searchInput = sidePanelPage.getByPlaceholder('Search plugins and tools...');
        await searchInput.fill('opentabs');

        await expect(sidePanelPage.getByText('Available')).toBeVisible({ timeout: 15_000 });
        await expect(sidePanelPage.getByRole('button', { name: 'Install' }).first()).toBeVisible();

        await searchInput.fill('');
        await expect(sidePanelPage.getByText('Available')).toBeHidden({ timeout: 5_000 });

        await sidePanelPage.close();
      } finally {
        await context.close().catch(() => {});
        await server.kill();
        fs.rmSync(cleanupDir, { recursive: true, force: true });
        cleanupTestConfigDir(configDir);
      }
    });

    test('install plugin from search results via Install button', async () => {
      test.skip(!slackArtifactsAvailable, 'published @opentabs-dev/opentabs-plugin-slack is missing build artifacts');
      test.slow();

      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-install-'));
      const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-sp-install-'));

      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: {
          'e2e-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
      });

      const server = await startMcpServer(configDir, false, undefined, {
        OPENTABS_SKIP_NPM_DISCOVERY: undefined,
        NPM_CONFIG_PREFIX: prefixDir,
      });
      const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
      setupAdapterSymlink(configDir, extensionDir);

      try {
        await waitForExtensionConnected(server);

        const sidePanelPage = await openSidePanel(context);
        await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

        const searchInput = sidePanelPage.getByPlaceholder('Search plugins and tools...');
        await searchInput.fill('slack');

        await expect(sidePanelPage.getByText('Available')).toBeVisible({ timeout: 15_000 });
        const installButton = sidePanelPage.getByRole('button', { name: 'Install' }).first();
        await expect(installButton).toBeVisible();
        await installButton.click();

        const slackCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Slack' });
        await expect(slackCard).toBeVisible({ timeout: 120_000 });
        await expect(sidePanelPage.getByText('Available')).toBeHidden({ timeout: 5_000 });
        await expect(slackCard).toContainText('Slack');

        await sidePanelPage.close();
      } finally {
        await context.close().catch(() => {});
        await server.kill();
        fs.rmSync(cleanupDir, { recursive: true, force: true });
        fs.rmSync(prefixDir, { recursive: true, force: true });
        cleanupTestConfigDir(configDir);
      }
    });
  });

  test('uninstall plugin via three-dot menu and confirmation dialog', async () => {
    test.skip(!slackArtifactsAvailable, 'published @opentabs-dev/opentabs-plugin-slack is missing build artifacts');
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-uninstall-'));
    const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-sp-uninstall-'));

    // Pre-install the slack plugin into the isolated prefix dir so the server
    // discovers it on startup via npm auto-discovery (bypasses npm search).
    execSync('npm install -g @opentabs-dev/opentabs-plugin-slack', {
      env: { ...process.env, NPM_CONFIG_PREFIX: prefixDir },
      stdio: 'pipe',
      timeout: 60_000,
    });

    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        'e2e-test': { permission: 'auto' },
        browser: { permission: 'auto' },
      },
    });

    const server = await startMcpServer(configDir, false, undefined, {
      OPENTABS_SKIP_NPM_DISCOVERY: undefined,
      NPM_CONFIG_PREFIX: prefixDir,
    });
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    let mcpClient: ReturnType<typeof createMcpClient> | undefined;

    try {
      // Verify the Slack plugin was discovered by the server before checking the UI.
      // npm auto-discovery (npm root -g + scan) can be slow on macOS CI runners
      // with cold npm caches — give it up to 90s.
      await waitForLog(server, 'Discovered plugin: slack', 90_000);

      await waitForExtensionConnected(server);

      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Wait for the Slack plugin card to appear in the side panel.
      const slackTrigger = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Slack' });
      await expect(slackTrigger).toBeVisible({ timeout: 60_000 });

      // --- Uninstall phase ---

      // Expand the Slack plugin card to reveal the three-dot menu
      await slackTrigger.click();
      await expect(slackTrigger).toHaveAttribute('aria-expanded', 'true');

      // The three-dot menu button is inside the same <h3> header as the trigger.
      // Scope to the header containing 'Slack' to avoid hitting other plugins' menus.
      const slackHeader = sidePanelPage.locator('h3').filter({ hasText: 'Slack' });
      const menuButton = slackHeader.getByLabel('Plugin options');
      await menuButton.click();

      // Click 'Uninstall' in the dropdown menu (Radix DropdownMenu uses role="menuitem")
      await sidePanelPage.getByRole('menuitem', { name: 'Uninstall' }).click();

      // Confirmation dialog appears — click the destructive 'Uninstall' button
      const dialog = sidePanelPage.locator('[role=dialog]');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Uninstall' }).click();

      // Wait for the Slack plugin card to disappear (npm uninstall -g + rediscovery)
      await expect(slackTrigger).toBeHidden({ timeout: 60_000 });

      // Verify via MCP that the plugin's tools are gone
      mcpClient = createMcpClient(server.port, server.secret);
      await mcpClient.initialize();
      const tools = await mcpClient.listTools();
      expect(tools.some(t => t.name.startsWith('slack_'))).toBe(false);

      await sidePanelPage.close();
    } finally {
      await mcpClient?.close();
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      fs.rmSync(prefixDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
