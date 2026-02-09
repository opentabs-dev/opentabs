import { startMcpServer, launchWithExtension } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, ExtensionFixture } from '../lib/index.js';

/**
 * Port Change E2E Tests
 *
 * These tests verify that when the WebSocket port is changed in the options page:
 * - The extension reconnects to the new port
 * - The side panel/icon correctly reflects connection status
 * - Changing to an invalid port shows disconnected status
 * - Changing back to a valid port reconnects successfully
 */

// Ports in high range unlikely to be in use by other services
const TEST_INVALID_PORTS = {
  PORT_1: 19999,
  PORT_2: 19998,
  PORT_3: 19997,
  PORT_4: 19996,
  PORT_5: 19995,
} as const;

interface HealthResponse {
  extension: 'connected' | 'disconnected';
}

test.describe('WebSocket Port Change', () => {
  let mcpServer: McpServerHarness;
  let extension: ExtensionFixture;

  // Skip if running in CI without display
  test.skip((): boolean => !!process.env.CI && !process.env.DISPLAY);

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
    extension = await launchWithExtension(mcpServer.wsPort);

    // Wait for extension to connect
    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  test.afterEach(async () => {
    if (extension) {
      await extension.cleanup();
    }
    await mcpServer.stop();
  });

  test('should show disconnected in side panel when port changed to non-existing server', async () => {
    // First verify we're connected
    const sidePanel1 = await extension.getSidePanelPage();
    await sidePanel1.waitForSelector('body', { timeout: 5000 });

    // Check initial connected state - look for "Connected" badge near MCP Server
    const connectedBadge1 = sidePanel1.locator('text=Connected').first();
    await expect(connectedBadge1).toBeVisible({ timeout: 5000 });
    await sidePanel1.close();

    // Change to a non-existing port (unlikely to have a server running)
    await extension.setWsPort(TEST_INVALID_PORTS.PORT_1);

    // Wait for reconnection attempts to fail
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Open side panel and verify disconnected state
    const sidePanel2 = await extension.getSidePanelPage();
    await sidePanel2.waitForSelector('body', { timeout: 5000 });

    // When MCP Server is disconnected, the side panel shows "Copy Cmd" button instead of "Connected"
    const disconnectedButton = sidePanel2.locator('text=Copy Cmd').first();
    await expect(disconnectedButton).toBeVisible({ timeout: 5000 });

    await sidePanel2.close();
  });

  test('should reconnect when port changed back to valid server', async () => {
    // First change to an invalid port
    await extension.setWsPort(TEST_INVALID_PORTS.PORT_2);

    // Wait for disconnection
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify disconnected - shows "Copy Cmd" button when disconnected
    const sidePanel1 = await extension.getSidePanelPage();
    await sidePanel1.waitForSelector('body', { timeout: 5000 });
    const disconnectedButton = sidePanel1.locator('text=Copy Cmd').first();
    await expect(disconnectedButton).toBeVisible({ timeout: 5000 });
    await sidePanel1.close();

    // Change back to the valid port
    await extension.setWsPort(mcpServer.wsPort);

    // Wait for reconnection
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify reconnected
    const sidePanel2 = await extension.getSidePanelPage();
    await sidePanel2.waitForSelector('body', { timeout: 5000 });

    // Should show connected for MCP Server
    const connectedBadge = sidePanel2.locator('text=Connected').first();
    await expect(connectedBadge).toBeVisible({ timeout: 5000 });

    await sidePanel2.close();
  });

  test('should update connection status via health endpoint after port change', async ({ request }) => {
    // Verify initially connected via health endpoint
    const response1 = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
    const body1 = await response1.json();
    expect(body1.extension).toBe('connected');

    // Change to an invalid port
    await extension.setWsPort(TEST_INVALID_PORTS.PORT_3);

    // Wait for disconnection
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Health endpoint should show disconnected
    const response2 = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
    const body2 = await response2.json();
    expect(body2.extension).toBe('disconnected');

    // Change back to valid port
    await extension.setWsPort(mcpServer.wsPort);

    // Wait for reconnection
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Health endpoint should show connected again
    const response3 = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
    const body3 = await response3.json();
    expect(body3.extension).toBe('connected');
  });

  test('should change port via options page UI', async () => {
    const optionsPage = await extension.getOptionsPage();
    await optionsPage.waitForSelector('body', { timeout: 5000 });

    // Find the port input field
    const portInput = optionsPage.locator('input[type="number"]');
    await expect(portInput).toBeVisible();

    // Clear and enter a new (invalid) port
    await portInput.fill(String(TEST_INVALID_PORTS.PORT_4));

    // Click save button
    const saveButton = optionsPage.getByText('Save');
    await saveButton.click();

    // Wait for save confirmation (button shows checkmark briefly)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Wait for reconnection attempts
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Open side panel and verify disconnected
    const sidePanel = await extension.getSidePanelPage();
    await sidePanel.waitForSelector('body', { timeout: 5000 });

    // When MCP Server is disconnected, shows "Copy Cmd" button
    const disconnectedButton = sidePanel.locator('text=Copy Cmd').first();
    await expect(disconnectedButton).toBeVisible({ timeout: 5000 });

    await sidePanel.close();
    await optionsPage.close();
  });

  test('should switch between two different MCP servers', async () => {
    // Start a second MCP server on a different port
    const mcpServer2 = await startMcpServer();
    await mcpServer2.waitForReady();

    const fetchHealth = async (port: number): Promise<HealthResponse> => {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.json() as Promise<HealthResponse>;
    };

    try {
      // Verify connected to first server
      const body1 = await fetchHealth(mcpServer.httpPort);
      expect(body1.extension).toBe('connected');

      // Second server should show disconnected
      const body2a = await fetchHealth(mcpServer2.httpPort);
      expect(body2a.extension).toBe('disconnected');

      // Switch to second server
      await extension.setWsPort(mcpServer2.wsPort);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // First server should now show disconnected
      const body1b = await fetchHealth(mcpServer.httpPort);
      expect(body1b.extension).toBe('disconnected');

      // Second server should show connected
      const body2b = await fetchHealth(mcpServer2.httpPort);
      expect(body2b.extension).toBe('connected');
    } finally {
      await mcpServer2.stop();
    }
  });
});

test.describe('Options Page Port Input', () => {
  let mcpServer: McpServerHarness;
  let extension: ExtensionFixture;

  // Skip if running in CI without display
  test.skip((): boolean => !!process.env.CI && !process.env.DISPLAY);

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
    extension = await launchWithExtension(mcpServer.wsPort);
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  test.afterEach(async () => {
    if (extension) {
      await extension.cleanup();
    }
    await mcpServer.stop();
  });

  test('should display current port in options page', async () => {
    const optionsPage = await extension.getOptionsPage();
    await optionsPage.waitForSelector('body', { timeout: 5000 });

    const portInput = optionsPage.locator('input[type="number"]');
    await expect(portInput).toBeVisible();

    // Should show the configured port
    const value = await portInput.inputValue();
    expect(parseInt(value, 10)).toBe(mcpServer.wsPort);

    await optionsPage.close();
  });

  test('should show save button enabled only when port changed', async () => {
    const optionsPage = await extension.getOptionsPage();
    await optionsPage.waitForSelector('body', { timeout: 5000 });

    const portInput = optionsPage.locator('input[type="number"]');
    const saveButton = optionsPage.getByText('Save');

    // Initially save button should be disabled (no changes)
    await expect(saveButton).toBeDisabled();

    // Change the port
    await portInput.fill('12345');

    // Save button should now be enabled
    await expect(saveButton).toBeEnabled();

    // Change back to original
    await portInput.fill(String(mcpServer.wsPort));

    // Save button should be disabled again
    await expect(saveButton).toBeDisabled();

    await optionsPage.close();
  });

  test('should save port on Enter key press', async () => {
    const optionsPage = await extension.getOptionsPage();
    await optionsPage.waitForSelector('body', { timeout: 5000 });

    const portInput = optionsPage.locator('input[type="number"]');

    // Change to an invalid port and press Enter
    await portInput.fill(String(TEST_INVALID_PORTS.PORT_5));
    await portInput.press('Enter');

    // Wait for save and reconnection attempt
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify the extension tried to connect to new port (will be disconnected)
    const sidePanel = await extension.getSidePanelPage();
    await sidePanel.waitForSelector('body', { timeout: 5000 });

    // When MCP Server is disconnected, shows "Copy Cmd" button
    const disconnectedButton = sidePanel.locator('text=Copy Cmd').first();
    await expect(disconnectedButton).toBeVisible({ timeout: 5000 });

    await sidePanel.close();
    await optionsPage.close();
  });
});
