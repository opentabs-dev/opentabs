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

/**
 * Check if the slack plugin on npm has iconSvg in its opentabs metadata.
 * Returns true when the published version includes embedded icons.
 */
const npmPluginHasIcons = (): boolean => {
  try {
    const result = execSync('npm view @opentabs-dev/opentabs-plugin-slack opentabs.iconSvg --json', {
      encoding: 'utf8',
      timeout: 15_000,
    });
    const value = JSON.parse(result.trim()) as string | null;
    return typeof value === 'string' && value.length > 0;
  } catch {
    return false;
  }
};

let searchAvailable = false;
let slackArtifactsAvailable = false;
let iconsAvailable = false;
let npmChecksInitialized = false;

const initNpmChecks = () => {
  if (npmChecksInitialized) return;
  npmChecksInitialized = true;
  searchAvailable = npmSearchFindsPlugins();
  slackArtifactsAvailable = npmSlackPluginHasArtifacts();
  iconsAvailable = npmPluginHasIcons();
};

test.describe('Side panel npm search', () => {
  test.beforeAll(() => {
    initNpmChecks();
  });

  test.describe('search-dependent tests', () => {
    test.beforeEach(() => {
      test.skip(!searchAvailable, 'npm search index does not include opentabs-plugin packages');
    });

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

    test('search results display SVG icons from npm registry', async () => {
      test.skip(!iconsAvailable, 'published @opentabs-dev plugins do not have icons yet');
      test.slow();

      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-search-icons-'));
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
        await searchInput.fill('slack');

        await expect(sidePanelPage.getByText('Available')).toBeVisible({ timeout: 15_000 });
        await expect(sidePanelPage.getByRole('button', { name: 'Install' }).first()).toBeVisible();

        // The first NpmPluginCard should have an SVG icon rendered by PluginIcon.
        // PluginIcon renders SVG via dangerouslySetInnerHTML inside an overflow-hidden div.
        const firstInstallButton = sidePanelPage.getByRole('button', { name: 'Install' }).first();
        const firstCard = firstInstallButton.locator('xpath=ancestor::div[contains(@class,"border-2")][1]');
        const svgIcon = firstCard.locator('svg').first();
        await expect(svgIcon).toBeVisible({ timeout: 5_000 });

        await sidePanelPage.close();
      } finally {
        await context.close().catch(() => {});
        await server.kill();
        fs.rmSync(cleanupDir, { recursive: true, force: true });
        cleanupTestConfigDir(configDir);
      }
    });

    test('search result icons change between light and dark mode', async () => {
      test.skip(!iconsAvailable, 'published @opentabs-dev plugins do not have icons yet');
      test.slow();

      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-search-icons-dark-'));
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
        await searchInput.fill('slack');

        await expect(sidePanelPage.getByText('Available')).toBeVisible({ timeout: 15_000 });
        await expect(sidePanelPage.getByRole('button', { name: 'Install' }).first()).toBeVisible();

        // Verify icon is present in light mode
        const firstInstallButton = sidePanelPage.getByRole('button', { name: 'Install' }).first();
        const firstCard = firstInstallButton.locator('xpath=ancestor::div[contains(@class,"border-2")][1]');
        const svgIcon = firstCard.locator('svg').first();
        await expect(svgIcon).toBeVisible({ timeout: 5_000 });
        const lightSvgHtml = await svgIcon.innerHTML();
        expect(lightSvgHtml.length).toBeGreaterThan(0);

        // Toggle to dark mode
        const darkToggle = sidePanelPage.getByLabel('Switch to dark mode');
        await darkToggle.click();
        await expect(sidePanelPage.locator('html')).toHaveClass(/dark/);

        // Wait for the icon to re-render with dark variant
        await sidePanelPage.waitForTimeout(500);

        // Verify icon is still present in dark mode
        const darkSvgHtml = await svgIcon.innerHTML();
        expect(darkSvgHtml.length).toBeGreaterThan(0);

        await sidePanelPage.close();
      } finally {
        await context.close().catch(() => {});
        await server.kill();
        fs.rmSync(cleanupDir, { recursive: true, force: true });
        cleanupTestConfigDir(configDir);
      }
    });

    test('search results without icons render letter-avatar fallback', async () => {
      test.slow();

      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-search-fallback-'));
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

        // When plugins have no icons, PluginIcon renders a letter avatar —
        // a <span> with a single uppercase letter and a colored background.
        const firstInstallButton = sidePanelPage.getByRole('button', { name: 'Install' }).first();
        const firstCard = firstInstallButton.locator('xpath=ancestor::div[contains(@class,"border-2")][1]');
        // The icon container is the first child div of the card's header row
        const iconContainer = firstCard.locator('div').first();

        if (iconsAvailable) {
          // If plugins have icons, verify SVG is rendered
          await expect(iconContainer.locator('svg').first()).toBeVisible({ timeout: 5_000 });
        } else {
          // If plugins lack icons, verify the letter avatar span exists
          const letterSpan = iconContainer.locator('span').first();
          await expect(letterSpan).toBeVisible({ timeout: 5_000 });
          const letter = await letterSpan.textContent();
          expect(letter).toMatch(/^[A-Z]$/);
        }

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
      test.skip(
        process.platform === 'darwin' && !!process.env.CI,
        'npm global install into isolated prefix is unreliable on macOS CI runners',
      );
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

  test.describe('stress', () => {
    test.beforeEach(() => {
      test.skip(!searchAvailable, 'npm search index does not include opentabs-plugin packages');
    });

    test('rapid search query spam settles to final query without crash', async () => {
      test.slow();

      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-search-stress-'));
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

      const pageErrors: Error[] = [];

      try {
        await waitForExtensionConnected(server);

        const sidePanelPage = await openSidePanel(context);
        sidePanelPage.on('pageerror', err => pageErrors.push(err));
        await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

        const searchInput = sidePanelPage.getByPlaceholder('Search plugins and tools...');

        // Type 10 different queries with 50ms between each to stress the debounce
        const queries = ['a', 'ab', 'abc', 'react', 'slack', 'dis', 'disc', 'disco', 'discord', 'todoist'];
        for (const query of queries) {
          await searchInput.fill(query);
          await sidePanelPage.waitForTimeout(50);
        }

        // Wait for final debounce (400ms) + network response to settle
        await sidePanelPage.waitForTimeout(2_000);

        // Verify no crash — side panel should still be responsive
        await expect(searchInput).toBeVisible();

        // If results appeared, they should be from a recent query, not stale ones.
        // We can't assert specific npm results, but we verify no zombie state.
        const availableSection = sidePanelPage.getByText('Available');
        if (await availableSection.isVisible()) {
          // Available section is present — results loaded for some query
          await expect(sidePanelPage.getByRole('button', { name: 'Install' }).first()).toBeVisible({ timeout: 5_000 });
        }

        // Clear search and verify clean state
        await searchInput.fill('');
        await expect(availableSection).toBeHidden({ timeout: 5_000 });

        expect(pageErrors).toHaveLength(0);

        await sidePanelPage.close();
      } finally {
        await context.close().catch(() => {});
        await server.kill();
        fs.rmSync(cleanupDir, { recursive: true, force: true });
        cleanupTestConfigDir(configDir);
      }
    });
  });

  test('uninstall plugin via three-dot menu and confirmation dialog', async () => {
    test.skip(!slackArtifactsAvailable, 'published @opentabs-dev/opentabs-plugin-slack is missing build artifacts');
    test.skip(
      process.platform === 'darwin',
      'npm global install into isolated prefix is unreliable on macOS — discovery finds 0 plugins',
    );
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

      // Wait for the dialog to close before checking the card — avoids racing
      // the Radix Dialog close animation with the subsequent UI assertion.
      await expect(dialog).toBeHidden();

      // Wait for the server to complete the npm uninstall + rediscovery cycle.
      // This is the primary reliability fix: instead of relying solely on the
      // UI card disappearing (which depends on the async chain: npm uninstall →
      // rediscovery → plugins.changed WS notification → getFullState → React
      // re-render), we first confirm the server finished processing. Under CI
      // load, the npm uninstall and rediscovery can be slow.
      await waitForLog(server, 'Plugin "slack" removed', 60_000);

      // Now wait for the UI to reflect the change — should be fast since the
      // server already sent plugins.changed.
      await expect(slackTrigger).toBeHidden({ timeout: 15_000 });

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
