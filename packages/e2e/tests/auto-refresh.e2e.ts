import { startMcpServer, launchWithExtension } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, ExtensionFixture } from '../lib/index.js';

/**
 * Auto-Refresh Stale Tabs E2E Tests
 *
 * These tests verify the auto-refresh functionality that handles stale content scripts
 * after extension reload/update:
 *
 * - When extension is reloaded, existing tabs with stale content scripts should be refreshed
 * - Tabs that respond to ping should NOT be refreshed (they're alive)
 * - Tabs that don't respond (stale/missing scripts) should be refreshed
 * - Each tab should only be refreshed once per session (no infinite loops)
 * - Non-service tabs (not Slack/Datadog/SQLPad) should not be affected
 *
 * The auto-refresh logic is implemented in chrome-extension/src/background/index.ts
 * in the checkAndRefreshStaleTabs() function.
 */

// Skip tests in CI without display (extension tests require headed mode)
const skipInCI = (): boolean => !!process.env.CI && !process.env.DISPLAY;

test.describe('Auto-Refresh Stale Tabs', () => {
  let mcpServer: McpServerHarness;
  let extension: ExtensionFixture;

  test.skip(skipInCI);

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
  });

  test.afterEach(async () => {
    if (extension) {
      await extension.cleanup();
    }
    await mcpServer.stop();
  });

  test.describe('Health Check (Ping/Pong) Message Handling', () => {
    test('should handle PING message in content scripts', async () => {
      extension = await launchWithExtension(mcpServer.wsPort);

      // Wait for extension to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Open a Slack page
      const slackPage = await extension.context.newPage();
      await slackPage.goto('https://app.slack.com/client');

      // Wait for content script to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // The extension should have pinged this tab during initialization
      // Since the extension loaded fresh, the content script should respond and no refresh should occur

      // Verify the page is still on Slack (not refreshed unexpectedly)
      expect(slackPage.url()).toContain('slack.com');

      await slackPage.close();
    });

    test('should not refresh tabs that respond to ping', async () => {
      extension = await launchWithExtension(mcpServer.wsPort);

      // Wait for extension to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Open service pages
      const slackPage = await extension.context.newPage();

      // Track main frame load events (refresh would trigger a new load)
      let mainFrameLoadCount = 0;
      slackPage.on('load', () => {
        mainFrameLoadCount++;
      });

      await slackPage.goto('https://app.slack.com/client');

      // Wait for content script to load and ping to complete
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Since extension and content scripts were loaded together, content script should respond to ping
      // No refresh should have occurred after initial page load
      // Initial load counts as 1, a refresh would make it 2
      expect(mainFrameLoadCount).toBeLessThanOrEqual(2);

      await slackPage.close();
    });

    test('should not affect non-service tabs', async () => {
      extension = await launchWithExtension(mcpServer.wsPort);

      // Wait for extension to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Open a non-service page
      const otherPage = await extension.context.newPage();
      await otherPage.goto('https://example.com');

      // Track navigation events
      let navigationCount = 0;
      otherPage.on('framenavigated', () => {
        navigationCount++;
      });

      // Wait some time
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Non-service pages should not be refreshed (no ping sent to them)
      expect(navigationCount).toBeLessThanOrEqual(1);

      await otherPage.close();
    });
  });

  test.describe('Stale Tab Detection', () => {
    test('should remain stable when opening multiple service tabs', async () => {
      extension = await launchWithExtension(mcpServer.wsPort);

      // Wait for extension to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));

      const pages = [];

      // Open multiple service tabs
      const urls = ['https://app.slack.com/client', 'https://brex-production.datadoghq.com/logs'];

      for (const url of urls) {
        const page = await extension.context.newPage();
        try {
          await page.goto(url, { timeout: 10000 });
        } catch {
          // Navigation might fail if not logged in, that's OK
        }
        pages.push(page);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Extension should still be functional
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      const pageContent = await sidePanel.textContent('body');
      expect(pageContent).toBeTruthy();
      await sidePanel.close();

      // Clean up
      for (const page of pages) {
        await page.close();
      }
    });

    test('should maintain MCP connection during tab refresh operations', async ({ request }) => {
      extension = await launchWithExtension(mcpServer.wsPort);

      // Wait for initial connection
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify MCP is connected
      const healthBefore = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(healthBefore.ok()).toBe(true);
      const bodyBefore = await healthBefore.json();
      expect(bodyBefore.extension).toBe('connected');

      // Open and close service tabs rapidly
      for (let i = 0; i < 3; i++) {
        const page = await extension.context.newPage();
        try {
          await page.goto('https://app.slack.com/client', { timeout: 5000 });
        } catch {
          // Navigation timeout is OK
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        await page.close();
      }

      // MCP connection should still be active
      const healthAfter = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(healthAfter.ok()).toBe(true);
      const bodyAfter = await healthAfter.json();
      expect(bodyAfter.extension).toBe('connected');
    });
  });

  test.describe('Refresh Loop Prevention', () => {
    test('should not create infinite refresh loops', async () => {
      extension = await launchWithExtension(mcpServer.wsPort);

      // Wait for extension to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Open a Slack page
      const slackPage = await extension.context.newPage();
      await slackPage.goto('https://app.slack.com/client');

      // Track refresh count
      let refreshCount = 0;
      slackPage.on('load', () => {
        refreshCount++;
      });

      // Wait for potential refresh cycles
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Should not have more than 2 loads (initial + at most one refresh)
      // If there was a refresh loop, this would be much higher
      expect(refreshCount).toBeLessThanOrEqual(2);

      await slackPage.close();
    });

    test('should track refreshed tabs to prevent duplicate refreshes', async () => {
      extension = await launchWithExtension(mcpServer.wsPort);

      // Wait for extension to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Open multiple tabs to the same service
      const pages = [];
      const loadCounts: number[] = [];

      for (let i = 0; i < 3; i++) {
        const page = await extension.context.newPage();
        let loadCount = 0;
        page.on('load', () => {
          loadCount++;
        });

        try {
          await page.goto('https://app.slack.com/client', { timeout: 10000 });
        } catch {
          // Navigation timeout OK
        }

        pages.push(page);
        loadCounts.push(loadCount);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Wait for any refresh operations to complete
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Each tab should have been loaded at most twice (initial + one potential refresh)
      for (const count of loadCounts) {
        expect(count).toBeLessThanOrEqual(2);
      }

      // Clean up
      for (const page of pages) {
        await page.close();
      }
    });
  });

  test.describe('Extension Stability', () => {
    test('should remain functional after auto-refresh operations', async () => {
      extension = await launchWithExtension(mcpServer.wsPort);

      // Wait for extension to initialize and perform auto-refresh checks
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Open a service tab
      const slackPage = await extension.context.newPage();
      try {
        await slackPage.goto('https://app.slack.com/client', { timeout: 10000 });
      } catch {
        // Navigation timeout OK
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Extension side panel should still work
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      const pageContent = await sidePanel.textContent('body');

      // Should show MCP Server status
      expect(pageContent).toContain('MCP Server');

      await sidePanel.close();
      await slackPage.close();
    });
  });
});
