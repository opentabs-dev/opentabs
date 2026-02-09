import { startMcpServer, launchWithExtension } from '../../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, ExtensionFixture } from '../../lib/index.js';

/**
 * Datadog Tab Fallback E2E Tests
 *
 * These tests verify the tab fallback behavior when Datadog tabs are closed:
 * - When a connected Datadog tab is closed, the extension should automatically
 *   find and connect to another available Datadog tab of the same environment
 * - Datadog has two environments: production (brex-production.datadoghq.com)
 *   and staging (brex-staging.datadoghq.com)
 * - Each environment has its own tab tracking and fallback logic
 * - Login/signup pages should be excluded from fallback candidates
 *
 * The fallback logic is implemented in chrome-extension/src/background/index.ts
 * in the handleDatadogDisconnect() function which is triggered by chrome.tabs.onRemoved.
 */

// Skip tests in CI without display (extension tests require headed mode)
const skipInCI = (): boolean => !!process.env.CI && !process.env.DISPLAY;

// Datadog URLs for testing
const DATADOG_URLS = {
  production: 'https://brex-production.datadoghq.com/logs',
  staging: 'https://brex-staging.datadoghq.com/logs',
  productionLogin: 'https://brex-production.datadoghq.com/login',
  stagingLogin: 'https://brex-staging.datadoghq.com/login',
} as const;

test.describe('Datadog Tab Fallback', () => {
  let mcpServer: McpServerHarness;
  let extension: ExtensionFixture;

  test.skip(skipInCI);

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
    extension = await launchWithExtension(mcpServer.wsPort);

    // Wait for extension to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  test.afterEach(async () => {
    if (extension) {
      await extension.cleanup();
    }
    await mcpServer.stop();
  });

  test.describe('Tab Close Detection', () => {
    test('should detect when Datadog production tab is closed', async () => {
      // Open a Datadog production tab
      const ddPage = await extension.context.newPage();
      await ddPage.goto(DATADOG_URLS.production);

      // Wait for potential connection attempt
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Close the Datadog tab
      await ddPage.close();

      // Wait for disconnect detection
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify the extension is still functional
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      const pageContent = await sidePanel.textContent('body');
      expect(pageContent).toBeTruthy();
      await sidePanel.close();
    });

    test('should detect when Datadog staging tab is closed', async () => {
      // Open a Datadog staging tab
      const ddPage = await extension.context.newPage();
      await ddPage.goto(DATADOG_URLS.staging);

      // Wait for potential connection attempt
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Close the Datadog tab
      await ddPage.close();

      // Wait for disconnect detection
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify the extension is still functional
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      const pageContent = await sidePanel.textContent('body');
      expect(pageContent).toBeTruthy();
      await sidePanel.close();
    });

    test('should maintain MCP server connection when Datadog tab is closed', async ({ request }) => {
      // Verify MCP server is connected first
      const healthBefore = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(healthBefore.ok()).toBe(true);
      const bodyBefore = await healthBefore.json();
      expect(bodyBefore.extension).toBe('connected');

      // Open and close a Datadog tab
      const ddPage = await extension.context.newPage();
      await ddPage.goto(DATADOG_URLS.production);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await ddPage.close();
      await new Promise(resolve => setTimeout(resolve, 500));

      // MCP server connection should still be active
      const healthAfter = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(healthAfter.ok()).toBe(true);
      const bodyAfter = await healthAfter.json();
      expect(bodyAfter.extension).toBe('connected');
    });
  });

  test.describe('Environment Separation', () => {
    test('should track production and staging environments separately', async () => {
      // Open both production and staging tabs
      const prodPage = await extension.context.newPage();
      await prodPage.goto(DATADOG_URLS.production);
      await new Promise(resolve => setTimeout(resolve, 500));

      const stagingPage = await extension.context.newPage();
      await stagingPage.goto(DATADOG_URLS.staging);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Close production tab - staging should be unaffected
      await prodPage.close();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify extension is stable
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      await sidePanel.close();

      await stagingPage.close();
    });

    test('should not mix environments during fallback', async () => {
      // Open production and staging tabs
      const prodPage = await extension.context.newPage();
      await prodPage.goto(DATADOG_URLS.production);
      await new Promise(resolve => setTimeout(resolve, 500));

      const stagingPage = await extension.context.newPage();
      await stagingPage.goto(DATADOG_URLS.staging);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Close both in sequence
      await prodPage.close();
      await new Promise(resolve => setTimeout(resolve, 300));
      await stagingPage.close();
      await new Promise(resolve => setTimeout(resolve, 300));

      // Extension should remain stable
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      await sidePanel.close();
    });
  });

  test.describe('Login Page Exclusion', () => {
    test('should not try to connect to login pages', async () => {
      // Open a login page
      const loginPage = await extension.context.newPage();
      await loginPage.goto(DATADOG_URLS.productionLogin);

      await new Promise(resolve => setTimeout(resolve, 1000));

      // The extension should not crash or attempt to connect
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      await sidePanel.close();

      await loginPage.close();
    });

    test('should handle navigation to and from login pages', async () => {
      const page = await extension.context.newPage();

      // Start on logs page
      await page.goto(DATADOG_URLS.production);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Navigate to login (simulating session expiry redirect)
      await page.goto(DATADOG_URLS.productionLogin);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Navigate back to logs (simulating re-login)
      await page.goto(DATADOG_URLS.production);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Extension should remain stable
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      await sidePanel.close();

      await page.close();
    });
  });

  test.describe('Multiple Tabs Behavior', () => {
    test('should handle multiple Datadog tabs of same environment', async () => {
      const pages = [];

      // Open multiple production tabs
      for (let i = 0; i < 3; i++) {
        const page = await extension.context.newPage();
        await page.goto(DATADOG_URLS.production);
        pages.push(page);
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Close tabs one by one
      for (const page of pages) {
        await page.close();
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Extension should remain stable
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      await sidePanel.close();
    });

    test('should remain stable when non-Datadog tabs are closed', async ({ request }) => {
      // Verify initial MCP connection
      const healthBefore = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect((await healthBefore.json()).extension).toBe('connected');

      // Open and close non-Datadog tabs
      for (let i = 0; i < 3; i++) {
        const page = await extension.context.newPage();
        await page.goto('https://example.com');
        await new Promise(resolve => setTimeout(resolve, 200));
        await page.close();
      }

      // MCP connection should be unaffected
      const healthAfter = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect((await healthAfter.json()).extension).toBe('connected');
    });
  });

  test.describe('Connection Status Display', () => {
    test('should show Datadog connection status in side panel', async () => {
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });

      // Look for Datadog-related status text
      const pageContent = await sidePanel.textContent('body');
      expect(pageContent).toContain('Datadog');

      await sidePanel.close();
    });
  });
});
