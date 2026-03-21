/**
 * E2E tests for the MCP gateway endpoint at /mcp/gateway.
 *
 * The gateway exposes exactly 2 meta-tools (opentabs_list_tools and
 * opentabs_call) that proxy all OpenTabs functionality through a minimal
 * context footprint. These tests exercise the full stack through the
 * gateway endpoint.
 */

import { expect, test } from './fixtures.js';
import { setupToolTest } from './helpers.js';

// ---------------------------------------------------------------------------
// Minimal MCP client for the gateway endpoint (/mcp/gateway)
// ---------------------------------------------------------------------------

interface GatewayClient {
  initialize: () => Promise<void>;
  listTools: () => Promise<Array<{ name: string; description: string; inputSchema?: unknown }>>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>;
  close: () => Promise<void>;
}

const createGatewayClient = (port: number, secret?: string): GatewayClient => {
  let sessionId: string | null = null;
  let nextId = 1;
  const gatewayUrl = `http://localhost:${port}/mcp/gateway`;

  const request = async (body: unknown, timeoutMs = 30_000): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    if (sessionId) headers['mcp-session-id'] = sessionId;

    const res = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gateway request failed (${res.status}): ${text}`);
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;

    const contentType = res.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      return (await res.json()) as Record<string, unknown>;
    }

    // SSE response
    const text = await res.text();
    const dataLines = text
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trim());

    const messages: Record<string, unknown>[] = [];
    for (const raw of dataLines) {
      try {
        messages.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // skip non-JSON
      }
    }

    if (messages.length === 0) {
      throw new Error(`Gateway SSE response had no JSON-RPC messages.\nRaw:\n${text.slice(0, 2000)}`);
    }

    const reqId = (body as Record<string, unknown>).id;
    if (reqId !== undefined) {
      const match = messages.find(m => m.id === reqId && ('result' in m || 'error' in m));
      if (match) return match;
    }

    const lastResponse = [...messages].reverse().find(m => 'result' in m || 'error' in m);
    if (lastResponse) return lastResponse;

    return messages[messages.length - 1] as Record<string, unknown>;
  };

  return {
    initialize: async () => {
      await request({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'e2e-gateway-client', version: '0.0.1' },
        },
        id: nextId++,
      });
      if (!sessionId) throw new Error('Gateway initialize did not return a session ID');

      // Fire-and-forget notification
      const notifHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (secret) notifHeaders.Authorization = `Bearer ${secret}`;
      if (sessionId) notifHeaders['mcp-session-id'] = sessionId;
      await fetch(gatewayUrl, {
        method: 'POST',
        headers: notifHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {});
    },

    listTools: async () => {
      const res = await request({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: nextId++,
      });
      const result = res.result as { tools: Array<{ name: string; description: string; inputSchema?: unknown }> };
      return result.tools;
    },

    callTool: async (name, args = {}) => {
      const res = await request(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name, arguments: args },
          id: nextId++,
        },
        60_000,
      );

      if (res.error) {
        const err = res.error as { message: string };
        return { content: err.message, isError: true };
      }

      const result = res.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      const text = result.content.map(c => c.text).join('');
      return { content: text, isError: result.isError === true };
    },

    close: async () => {
      if (!sessionId) return;
      try {
        const deleteHeaders: Record<string, string> = { 'mcp-session-id': sessionId };
        if (secret) deleteHeaders.Authorization = `Bearer ${secret}`;
        await fetch(gatewayUrl, {
          method: 'DELETE',
          headers: deleteHeaders,
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        // best-effort
      }
      sessionId = null;
    },
  };
};

// ---------------------------------------------------------------------------
// Gateway tools/list — exactly 2 meta-tools
// ---------------------------------------------------------------------------

test.describe('MCP Gateway — tool discovery', () => {
  test('gateway serves exactly 2 meta-tools', async ({ mcpServer }) => {
    await mcpServer.waitForHealth(h => h.status === 'ok');

    const client = createGatewayClient(mcpServer.port, mcpServer.secret);
    try {
      await client.initialize();
      const tools = await client.listTools();

      expect(tools.length).toBe(2);

      const toolNames = tools.map(t => t.name).sort();
      expect(toolNames).toEqual(['opentabs_call', 'opentabs_list_tools']);

      // Each tool has a description and inputSchema
      for (const tool of tools) {
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema).toBeDefined();
      }
    } finally {
      await client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// opentabs_list_tools — proxied tool discovery
// ---------------------------------------------------------------------------

test.describe('MCP Gateway — opentabs_list_tools', () => {
  test('returns e2e-test plugin tools with schemas', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const client = createGatewayClient(mcpServer.port, mcpServer.secret);
    try {
      await client.initialize();

      const result = await client.callTool('opentabs_list_tools', {});
      expect(result.isError).toBe(false);

      const tools = JSON.parse(result.content) as Array<{
        name: string;
        description: string;
        plugin: string;
        inputSchema: unknown;
      }>;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      // e2e-test tools should be present
      const e2eTools = tools.filter(t => t.plugin === 'e2e-test');
      expect(e2eTools.length).toBeGreaterThan(0);
      expect(e2eTools.some(t => t.name === 'e2e-test_get_status')).toBe(true);

      // Browser tools should be present
      const browserTools = tools.filter(t => t.plugin === 'browser');
      expect(browserTools.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });

  test('plugin filter works', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const client = createGatewayClient(mcpServer.port, mcpServer.secret);
    try {
      await client.initialize();

      const result = await client.callTool('opentabs_list_tools', { plugin: 'e2e-test' });
      expect(result.isError).toBe(false);

      const tools = JSON.parse(result.content) as Array<{ name: string; plugin: string }>;
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.plugin).toBe('e2e-test');
      }
    } finally {
      await client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// opentabs_call — proxied tool invocation
// ---------------------------------------------------------------------------

test.describe('MCP Gateway — opentabs_call', () => {
  test('invokes e2e-test_get_status through the gateway', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const client = createGatewayClient(mcpServer.port, mcpServer.secret);
    try {
      await client.initialize();

      const result = await client.callTool('opentabs_call', {
        tool: 'e2e-test_get_status',
        arguments: {},
      });
      expect(result.isError).toBe(false);

      // The gateway wraps the tool result — parse the content
      const output = JSON.parse(result.content) as Record<string, unknown>;
      expect(output.ok).toBe(true);
      expect(output.version).toBe('1.0.0-test');
    } finally {
      await client.close();
    }
  });

  test('invokes e2e-test_echo with arguments through the gateway', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const client = createGatewayClient(mcpServer.port, mcpServer.secret);
    try {
      await client.initialize();

      const result = await client.callTool('opentabs_call', {
        tool: 'e2e-test_echo',
        arguments: { message: 'gateway-test' },
      });
      expect(result.isError).toBe(false);

      const output = JSON.parse(result.content) as Record<string, unknown>;
      expect(output.ok).toBe(true);
      expect(output.message).toBe('gateway-test');
    } finally {
      await client.close();
    }
  });

  test('returns error for unknown tool', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const client = createGatewayClient(mcpServer.port, mcpServer.secret);
    try {
      await client.initialize();

      const result = await client.callTool('opentabs_call', {
        tool: 'nonexistent_tool',
        arguments: {},
      });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
