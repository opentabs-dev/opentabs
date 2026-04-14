/**
 * browser_notify E2E tests — verifies the notification tool is registered,
 * dispatches successfully, and handles edge cases.
 *
 * Tests exercise the full stack: MCP client → MCP server → WebSocket →
 * extension → chrome.notifications API.
 */

import type { McpClient, McpServer } from './fixtures.js';
import { expect, test } from './fixtures.js';
import { waitForExtensionConnected, waitForLog } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const initAndListTools = async (
  mcpServer: McpServer,
  mcpClient: McpClient,
): Promise<Array<{ name: string; description: string; inputSchema?: unknown }>> => {
  await waitForExtensionConnected(mcpServer);
  await waitForLog(mcpServer, 'plugin(s) mapped');
  return mcpClient.listTools();
};

// ---------------------------------------------------------------------------
// Tool listing
// ---------------------------------------------------------------------------

test.describe('browser_notify — tool listing', () => {
  test('browser_notify appears in tools/list', async ({ mcpServer, extensionContext: _ext, mcpClient }) => {
    const tools = await initAndListTools(mcpServer, mcpClient);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('browser_notify');
  });

  test('has expected input schema properties', async ({ mcpServer, extensionContext: _ext, mcpClient }) => {
    const tools = await initAndListTools(mcpServer, mcpClient);
    const notifyTool = tools.find(t => t.name === 'browser_notify');
    expect(notifyTool).toBeDefined();

    const schema = notifyTool?.inputSchema as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe('object');

    const expectedProperties = ['title', 'message', 'iconUrl', 'requireInteraction', 'contextMessage', 'url'];
    for (const prop of expectedProperties) {
      expect(schema.properties).toHaveProperty(prop);
    }

    expect(schema.required).toContain('title');
    expect(schema.required).toContain('message');
  });

  test('description mentions desktop notification', async ({ mcpServer, extensionContext: _ext, mcpClient }) => {
    const tools = await initAndListTools(mcpServer, mcpClient);
    const notifyTool = tools.find(t => t.name === 'browser_notify');
    expect(notifyTool).toBeDefined();
    expect(notifyTool?.description.toLowerCase()).toContain('desktop notification');
  });
});
