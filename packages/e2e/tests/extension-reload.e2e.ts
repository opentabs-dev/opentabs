import { startMcpServer, createWsTestClient, createStreamableHttpClient, launchWithExtension } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, WsTestClient, StreamableHttpClient, ExtensionFixture } from '../lib/index.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Wait for a JSON-RPC request with a specific method from the WsTestClient.
 * Drains other messages (like pings) until the expected method arrives or timeout.
 */
const waitForJsonRpcMethod = async (
  client: WsTestClient,
  method: string,
  timeoutMs = 5000,
): Promise<JsonRpcRequest> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const message = (await client.waitForMessage(remaining)) as Record<string, unknown>;
    if (message.jsonrpc === '2.0' && message.method === method) {
      return message as unknown as JsonRpcRequest;
    }
  }
  throw new Error(`Timeout waiting for JSON-RPC method "${method}" after ${timeoutMs}ms`);
};

/**
 * Extension Reload E2E Tests
 *
 * These tests verify the reload_extension MCP tool works end-to-end:
 * MCP Client (callTool) -> MCP Server -> WebSocket Relay -> Extension (simulated) -> Response
 *
 * The WsTestClient simulates the Chrome extension, responding to the
 * system.reload JSON-RPC request the same way the real mcp-router does.
 */
test.describe('Extension Reload Tool', () => {
  let mcpServer: McpServerHarness;
  let extensionClient: WsTestClient;
  let mcpClient: StreamableHttpClient;

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    // Simulate the Chrome extension
    extensionClient = createWsTestClient(mcpServer.wsPort);
    await extensionClient.waitForConnection();

    // Consume the server_info message sent on connection
    await extensionClient.waitForMessage(3000);

    // Simulate Claude Code
    mcpClient = createStreamableHttpClient(mcpServer.httpPort);
    await mcpClient.initialize();
  });

  test.afterEach(async () => {
    mcpClient.close();
    extensionClient.close();
    await mcpServer.stop();
  });

  test('reload_extension tool is listed in available tools', async () => {
    const tools = await mcpClient.listTools();
    const reloadTool = tools.find(t => t.name === 'reload_extension');

    expect(reloadTool).toBeTruthy();
    expect(reloadTool!.description).toContain('Reload');
    expect(reloadTool!.description).toContain('Chrome extension');
  });

  test('reload_extension tool sends system.reload JSON-RPC request to extension', async () => {
    // Start the tool call in the background — it will block until the extension responds
    const toolCallPromise = mcpClient.callTool('reload_extension', {});

    // Wait for the system.reload JSON-RPC request to arrive at the extension
    const message = await waitForJsonRpcMethod(extensionClient, 'system.reload');

    expect(message.jsonrpc).toBe('2.0');
    expect(message.method).toBe('system.reload');
    expect(message.id).toBeTruthy();

    // Simulate the extension responding with success (as the real mcp-router does)
    extensionClient.send({
      jsonrpc: '2.0',
      id: message.id,
      result: { reloading: true },
    });

    // The tool call should complete successfully
    const result = (await toolCallPromise) as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);

    const text = result.content[0].text;
    const parsed = JSON.parse(text) as { message: string };
    expect(parsed.message).toContain('reload');
  });

  test('reload_extension tool returns error when extension is not connected', async () => {
    // Disconnect the simulated extension
    extensionClient.close();
    await new Promise(resolve => setTimeout(resolve, 300));

    // Tool call should return an error
    const result = (await mcpClient.callTool('reload_extension', {})) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.content).toBeTruthy();
    expect(result.content[0].text).toContain('Error');
  });

  test('reload_extension tool handles extension error response', async () => {
    const toolCallPromise = mcpClient.callTool('reload_extension', {});

    // Wait for the request
    const message = await waitForJsonRpcMethod(extensionClient, 'system.reload');

    // Simulate the extension responding with an error
    extensionClient.send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32603, message: 'Reload failed' },
    });

    // The tool should return an error result
    const result = (await toolCallPromise) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.content).toBeTruthy();
    expect(result.content[0].text).toContain('Error');
  });

  test('WebSocket connection remains stable after reload tool call', async () => {
    const toolCallPromise = mcpClient.callTool('reload_extension', {});

    const message = await waitForJsonRpcMethod(extensionClient, 'system.reload');

    extensionClient.send({
      jsonrpc: '2.0',
      id: message.id,
      result: { reloading: true },
    });

    await toolCallPromise;

    // The WebSocket connection should still be alive (the simulated extension
    // doesn't actually reload — only the real Chrome extension would)
    expect(extensionClient.isConnected()).toBe(true);

    // MCP session should still work
    const tools = await mcpClient.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  test('MCP session survives extension disconnect after reload', async () => {
    const toolCallPromise = mcpClient.callTool('reload_extension', {});

    const message = await waitForJsonRpcMethod(extensionClient, 'system.reload');

    extensionClient.send({
      jsonrpc: '2.0',
      id: message.id,
      result: { reloading: true },
    });

    await toolCallPromise;

    // Simulate the extension disconnecting (as happens during real reload)
    extensionClient.close();
    await new Promise(resolve => setTimeout(resolve, 300));

    // MCP session should still function (tool listing doesn't need extension)
    const tools = await mcpClient.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.find(t => t.name === 'reload_extension')).toBeTruthy();
  });

  test('extension can reconnect after reload and tool works again', async () => {
    // First reload call
    const toolCallPromise = mcpClient.callTool('reload_extension', {});
    const message = await waitForJsonRpcMethod(extensionClient, 'system.reload');
    extensionClient.send({ jsonrpc: '2.0', id: message.id, result: { reloading: true } });
    await toolCallPromise;

    // Simulate extension disconnect + reconnect (as happens during real reload)
    extensionClient.close();
    await new Promise(resolve => setTimeout(resolve, 300));

    const newExtensionClient = createWsTestClient(mcpServer.wsPort);
    await newExtensionClient.waitForConnection();
    // Consume server_info
    await newExtensionClient.waitForMessage(3000);

    // Second reload call should work with the new extension connection
    const toolCallPromise2 = mcpClient.callTool('reload_extension', {});
    const message2 = await waitForJsonRpcMethod(newExtensionClient, 'system.reload');

    expect(message2.method).toBe('system.reload');

    newExtensionClient.send({ jsonrpc: '2.0', id: message2.id, result: { reloading: true } });

    const result = (await toolCallPromise2) as { content: Array<{ type: string; text: string }> };
    expect(result.content[0].text).toContain('reload');

    newExtensionClient.close();
  });
});

/**
 * Real Extension Reload Tests
 *
 * These tests launch a real Chrome instance with the built extension loaded
 * and verify that chrome.runtime.reload() actually fires. After reload,
 * the extension's service worker restarts and reconnects to the MCP server.
 */
test.describe('Real Extension Reload', () => {
  let mcpServer: McpServerHarness;
  let extension: ExtensionFixture;
  let mcpClient: StreamableHttpClient;

  // Skip in CI without display — real Chrome extension tests need headed mode
  test.skip((): boolean => !!process.env.CI && !process.env.DISPLAY);

  // Real extension tests need more time (Chrome launch + extension init + WebSocket connect)
  test.setTimeout(120000);

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    extension = await launchWithExtension(mcpServer.wsPort);

    // Wait for extension to connect via WebSocket
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://127.0.0.1:${mcpServer.httpPort}/health`);
          const body = (await res.json()) as { extension: string };
          return body.extension;
        },
        { timeout: 30000, intervals: [500] },
      )
      .toBe('connected');

    mcpClient = createStreamableHttpClient(mcpServer.httpPort);
    await mcpClient.initialize();
  });

  test.afterEach(async () => {
    mcpClient?.close();
    if (extension) {
      await extension.cleanup();
    }
    await mcpServer.stop();
  });

  test('reload_extension triggers real chrome.runtime.reload', async () => {
    // Verify extension is connected before reload
    const health = await fetch(`http://127.0.0.1:${mcpServer.httpPort}/health`);
    const body = (await health.json()) as { extension: string };
    expect(body.extension).toBe('connected');

    // Call reload_extension — the real extension will receive system.reload,
    // ack it, then call chrome.runtime.reload() after 100ms
    const result = (await mcpClient.callTool('reload_extension', {})) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content[0].text).toContain('reload');

    // After reload, the extension disconnects (service worker restarts).
    // Poll until it goes disconnected to confirm reload actually happened.
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://127.0.0.1:${mcpServer.httpPort}/health`);
          const b = (await res.json()) as { extension: string };
          return b.extension;
        },
        { timeout: 5000, intervals: [100] },
      )
      .toBe('disconnected');

    // The extension disconnected — this proves chrome.runtime.reload() fired.
    // Reconnection depends on MV3 service worker lifecycle and is tested separately.
  });
});
