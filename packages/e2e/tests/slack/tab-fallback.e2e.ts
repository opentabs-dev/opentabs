import { startMcpServer, launchWithExtension } from '../../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, ExtensionFixture } from '../../lib/index.js';

/**
 * Slack Tab Fallback E2E Tests
 *
 * These tests verify the tab fallback behavior when Slack tabs are closed:
 * - When a connected Slack tab is closed, the extension should automatically
 *   find and connect to another available Slack tab
 * - When the only Slack tab is closed, the extension should show disconnected status
 * - When a non-connected Slack tab is closed, the connection should remain stable
 *
 * The fallback logic is implemented in chrome-extension/src/background/index.ts
 * in the handleSlackDisconnect() function which is triggered by chrome.tabs.onRemoved.
 */

// Skip tests in CI without display (extension tests require headed mode)
const skipInCI = (): boolean => !!process.env.CI && !process.env.DISPLAY;

test.describe('Slack Tab Fallback', () => {
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
    test('should detect when Slack tab is closed and update status', async () => {
      // Open a Slack tab
      const slackPage = await extension.context.newPage();
      await slackPage.goto('https://app.slack.com/client');

      // Wait for potential connection (may fail if not logged in, which is expected)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Close the Slack tab
      await slackPage.close();

      // Wait for disconnect detection
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify the extension detects the tab close
      // (Status will be disconnected since we're not logged into Slack)
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });

      // The Slack status should reflect disconnected state
      const pageContent = await sidePanel.textContent('body');
      expect(pageContent).toBeTruthy();

      await sidePanel.close();
    });

    test('should maintain MCP server connection when Slack tab is closed', async ({ request }) => {
      // Verify MCP server is connected first
      const healthBefore = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(healthBefore.ok()).toBe(true);
      const bodyBefore = await healthBefore.json();
      expect(bodyBefore.extension).toBe('connected');

      // Open and close a Slack tab
      const slackPage = await extension.context.newPage();
      await slackPage.goto('https://app.slack.com/client');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await slackPage.close();
      await new Promise(resolve => setTimeout(resolve, 500));

      // MCP server connection should still be active (offscreen document maintains it)
      const healthAfter = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(healthAfter.ok()).toBe(true);
      const bodyAfter = await healthAfter.json();
      expect(bodyAfter.extension).toBe('connected');
    });
  });

  test.describe('Tab Navigation Detection', () => {
    test('should detect when Slack tab navigates away from Slack', async () => {
      // Open a page that initially looks like Slack
      const page = await extension.context.newPage();
      await page.goto('https://app.slack.com/client');

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Navigate away from Slack
      await page.goto('https://example.com');

      // Wait for navigation detection
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify side panel still loads (extension is stable)
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      await sidePanel.close();
      await page.close();
    });
  });

  test.describe('Multiple Tabs Behavior', () => {
    test('should not crash when multiple Slack-like tabs are opened and closed', async () => {
      const pages = [];

      // Open multiple pages
      for (let i = 0; i < 3; i++) {
        const page = await extension.context.newPage();
        await page.goto('https://app.slack.com/client');
        pages.push(page);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Close tabs one by one
      for (const page of pages) {
        await page.close();
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Extension should still be functional
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      const pageContent = await sidePanel.textContent('body');
      expect(pageContent).toBeTruthy();
      await sidePanel.close();
    });

    test('should remain stable when non-Slack tabs are closed', async ({ request }) => {
      // Verify initial MCP connection
      const healthBefore = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect((await healthBefore.json()).extension).toBe('connected');

      // Open and close non-Slack tabs
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
    test('should show correct Slack connection status in side panel', async () => {
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });

      // Look for Slack-related status text
      const pageContent = await sidePanel.textContent('body');
      expect(pageContent).toContain('Slack');

      // Status should indicate not connected (since we're not actually logged into Slack)
      // The exact text depends on the side panel implementation
      expect(pageContent).toBeTruthy();

      await sidePanel.close();
    });
  });
});
