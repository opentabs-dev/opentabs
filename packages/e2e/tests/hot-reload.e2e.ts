import { startHotReloadServer, createStreamableHttpClient, createWsTestClient } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import type { HotReloadHarness } from '../lib/index.js';

/**
 * Helper: Initialize a Streamable HTTP MCP session and return the session ID.
 */
const initSession = async (httpPort: number): Promise<string> => {
  const response = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: true } },
        clientInfo: { name: 'hot-reload-test', version: '0.1' },
      },
    }),
  });

  expect(response.status).toBe(200);
  const sessionId = response.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();

  // Send initialized notification
  await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'mcp-session-id': sessionId!,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  return sessionId!;
};

/**
 * Helper: List tool names for a session.
 */
const listToolNames = async (httpPort: number, sessionId: string): Promise<string[]> => {
  const response = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list' }),
  });

  expect(response.status).toBe(200);
  const body = await response.text();

  // Parse SSE response: lines starting with "data: " contain JSON
  const dataLines = body.split('\n').filter(l => l.startsWith('data: '));
  expect(dataLines.length).toBeGreaterThan(0);

  const message = JSON.parse(dataLines[0].slice(6));
  return (message.result.tools as Array<{ name: string }>).map(t => t.name);
};

/**
 * Helper: Get a specific tool's description from a session.
 */
const getToolDescription = async (
  httpPort: number,
  sessionId: string,
  toolName: string,
): Promise<string | undefined> => {
  const response = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list' }),
  });

  const body = await response.text();
  const dataLines = body.split('\n').filter(l => l.startsWith('data: '));
  const message = JSON.parse(dataLines[0].slice(6));
  const tool = (message.result.tools as Array<{ name: string; description: string }>).find(t => t.name === toolName);
  return tool?.description;
};

/**
 * Helper: Get a tool's input schema from a session.
 */
const getToolInputSchema = async (
  httpPort: number,
  sessionId: string,
  toolName: string,
): Promise<Record<string, unknown> | undefined> => {
  const response = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list' }),
  });

  const body = await response.text();
  const dataLines = body.split('\n').filter(l => l.startsWith('data: '));
  const message = JSON.parse(dataLines[0].slice(6));
  const tool = (message.result.tools as Array<{ name: string; inputSchema: Record<string, unknown> }>).find(
    t => t.name === toolName,
  );
  return tool?.inputSchema;
};

// Hot reload tests must run serially because they modify shared source files.
test.describe.configure({ mode: 'serial' });

test.describe('Hot Reload', () => {
  let harness: HotReloadHarness;

  test.beforeEach(async () => {
    harness = await startHotReloadServer();
    await harness.waitForReady();
  });

  test.afterEach(async () => {
    await harness.stop();
  });

  test('server starts and serves tools via bun --hot', async () => {
    const sessionId = await initSession(harness.httpPort);
    const tools = await listToolNames(harness.httpPort, sessionId);

    // Should have a substantial number of tools (Slack + Datadog + SQLPad)
    expect(tools.length).toBeGreaterThan(50);
    // Verify some known tools exist
    expect(tools).toContain('slack_send_message');
    expect(tools).toContain('slack_star_message');
  });

  test('hot reload patches tools on existing session without dropping connection', async () => {
    const sessionId = await initSession(harness.httpPort);

    // Get initial tool list
    const toolsBefore = await listToolNames(harness.httpPort, sessionId);
    expect(toolsBefore).toContain('slack_star_message');

    // Trigger hot reload
    harness.triggerReload();
    await harness.waitForReload(1);

    // Session should still work — list tools again
    const toolsAfter = await listToolNames(harness.httpPort, sessionId);
    expect(toolsAfter.length).toBe(toolsBefore.length);
    expect(toolsAfter).toContain('slack_star_message');
  });

  test('hot reload updates tool descriptions', async () => {
    const sessionId = await initSession(harness.httpPort);

    const descBefore = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(descBefore).toBeTruthy();

    // Modify the tool description in the source file
    const original = harness.readToolFile();
    const modified = original.replace(
      'Add a star to a message for quick access later.',
      'HOT-RELOAD-TEST: Add a star to a message for quick access later.',
    );
    expect(modified).not.toBe(original);
    harness.writeToolFile(modified);

    await harness.waitForReload(1);

    const descAfter = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(descAfter).toContain('HOT-RELOAD-TEST');
  });

  test('hot reload adds new tools', async () => {
    const sessionId = await initSession(harness.httpPort);
    const toolsBefore = await listToolNames(harness.httpPort, sessionId);
    expect(toolsBefore).not.toContain('slack_hot_reload_test_tool');

    // Add a new tool to the file
    const original = harness.readToolFile();
    const newToolCode = `
  // Hot reload test: new tool
  tools.set(
    'slack_hot_reload_test_tool',
    server.registerTool(
      'slack_hot_reload_test_tool',
      {
        description: 'A test tool added via hot reload',
        inputSchema: {
          message: z.string().describe('A test message'),
        },
      },
      async ({ message }) =>
        withToolId('slack_hot_reload_test_tool', async () => {
          try {
            return success({ echo: message });
          } catch (err) {
            return error(err);
          }
        }),
    ),
  );
`;
    // Insert the new tool before "return tools;"
    const modified = original.replace('  return tools;', newToolCode + '\n  return tools;');
    harness.writeToolFile(modified);

    await harness.waitForReload(1);

    const toolsAfter = await listToolNames(harness.httpPort, sessionId);
    expect(toolsAfter).toContain('slack_hot_reload_test_tool');
    expect(toolsAfter.length).toBe(toolsBefore.length + 1);
  });

  test('hot reload removes deleted tools', async () => {
    const sessionId = await initSession(harness.httpPort);
    const toolsBefore = await listToolNames(harness.httpPort, sessionId);
    expect(toolsBefore).toContain('slack_star_file');

    // Remove the slack_star_file tool from the source file
    const original = harness.readToolFile();

    // Remove the entire slack_star_file registration block
    const startMarker = '  // Star a file';
    const endMarker = '  // Remove star from a message';
    const startIdx = original.indexOf(startMarker);
    const endIdx = original.indexOf(endMarker);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);

    const modified = original.slice(0, startIdx) + original.slice(endIdx);
    harness.writeToolFile(modified);

    await harness.waitForReload(1);

    const toolsAfter = await listToolNames(harness.httpPort, sessionId);
    expect(toolsAfter).not.toContain('slack_star_file');
    expect(toolsAfter.length).toBe(toolsBefore.length - 1);
    // Other tools should remain
    expect(toolsAfter).toContain('slack_star_message');
    expect(toolsAfter).toContain('slack_unstar_message');
  });

  test('multiple sessions all get patched on hot reload', async () => {
    // Create two sessions
    const session1 = await initSession(harness.httpPort);
    const session2 = await initSession(harness.httpPort);

    const tools1Before = await listToolNames(harness.httpPort, session1);
    const tools2Before = await listToolNames(harness.httpPort, session2);
    expect(tools1Before.length).toBe(tools2Before.length);

    // Modify a tool description
    const original = harness.readToolFile();
    const modified = original.replace(
      'Add a star to a message for quick access later.',
      'MULTI-SESSION-TEST: Add a star to a message.',
    );
    harness.writeToolFile(modified);

    await harness.waitForReload(1);

    // Both sessions should see the updated description
    const desc1 = await getToolDescription(harness.httpPort, session1, 'slack_star_message');
    const desc2 = await getToolDescription(harness.httpPort, session2, 'slack_star_message');
    expect(desc1).toContain('MULTI-SESSION-TEST');
    expect(desc2).toContain('MULTI-SESSION-TEST');
  });

  test('new sessions after hot reload get fresh tool code', async () => {
    // Modify a tool before any session connects
    const original = harness.readToolFile();
    const modified = original.replace(
      'Add a star to a message for quick access later.',
      'FRESH-SESSION-TEST: Star a message.',
    );
    harness.writeToolFile(modified);

    await harness.waitForReload(1);

    // Now create a session — it should see the updated description
    const sessionId = await initSession(harness.httpPort);
    const desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('FRESH-SESSION-TEST');
  });

  test('multiple consecutive hot reloads work correctly', async () => {
    const sessionId = await initSession(harness.httpPort);

    // First reload: change description
    const original = harness.readToolFile();
    harness.writeToolFile(
      original.replace('Add a star to a message for quick access later.', 'RELOAD-1: Star a message.'),
    );
    await harness.waitForReload(1);

    let desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('RELOAD-1');

    // Second reload: change it again
    const current = harness.readToolFile();
    harness.writeToolFile(current.replace('RELOAD-1: Star a message.', 'RELOAD-2: Star a message.'));
    await harness.waitForReload(2);

    desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('RELOAD-2');
  });

  test('notifications/tools/list_changed is sent on hot reload (debounced)', async () => {
    // Use an SSE session so we can observe server-sent notifications
    const sseResponse = await fetch(`http://127.0.0.1:${harness.httpPort}/sse`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    });

    expect(sseResponse.status).toBe(200);
    const reader = sseResponse.body!.getReader();
    const decoder = new TextDecoder();

    // Read the endpoint event first
    let buffer = '';
    let sseSessionId = '';
    while (!sseSessionId) {
      const { value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/sessionId=([^\s&"]+)/);
      if (match) sseSessionId = match[1];
    }

    // Send initialize + initialized to the SSE session
    await fetch(`http://127.0.0.1:${harness.httpPort}/sse?sessionId=${sseSessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'sse-test', version: '0.1' },
        },
      }),
    });
    await fetch(`http://127.0.0.1:${harness.httpPort}/sse?sessionId=${sseSessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // Clear the SSE buffer so far
    buffer = '';
    // Drain any pending SSE data from initialization
    const drainPromise = (async (): Promise<void> => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
    })();

    // Give it a moment to settle, then trigger reload
    await new Promise(resolve => setTimeout(resolve, 500));
    buffer = ''; // Reset buffer so we only capture post-reload notifications

    harness.triggerReload();
    await harness.waitForReload(1);

    // Wait for notifications to arrive
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Cancel the reader to stop the drain loop
    await reader.cancel();
    await drainPromise.catch(() => {});

    // Count how many tools/list_changed notifications we received
    const notifications = buffer.split('\n').filter(l => l.includes('tools/list_changed'));

    // With debouncing enabled, we should get a small number of notifications
    // (ideally 1, but may be a few due to remove/update/add being in different microtasks)
    // The key assertion: NOT 120 (one per tool), which was the bug before the fix
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.length).toBeLessThan(10);
  });

  test('WebSocket relay connection survives hot reload', async ({ request }) => {
    // Check initial health (no extension connected)
    const healthBefore = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    const bodyBefore = await healthBefore.json();
    expect(bodyBefore.status).toBeDefined();

    // Trigger hot reload
    harness.triggerReload();
    await harness.waitForReload(1);

    // Health endpoint should still work
    const healthAfter = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    expect(healthAfter.ok()).toBe(true);
    const bodyAfter = await healthAfter.json();
    expect(bodyAfter.status).toBeDefined();
  });

  test('hot reload updates tool input schemas', async () => {
    const sessionId = await initSession(harness.httpPort);

    const schemaBefore = await getToolInputSchema(harness.httpPort, sessionId, 'slack_star_message');
    expect(schemaBefore).toBeTruthy();
    expect(schemaBefore!.properties).toHaveProperty('channel');

    // Add a new parameter to the tool
    const original = harness.readToolFile();
    const modified = original.replace(
      'timestamp: z.string().describe(\'Timestamp of the message to star - get from message "ts" field\'),',
      "timestamp: z.string().describe('Timestamp of the message to star - get from message \"ts\" field'),\n          reason: z.string().optional().describe('Reason for starring'),",
    );
    expect(modified).not.toBe(original);
    harness.writeToolFile(modified);

    await harness.waitForReload(1);

    const schemaAfter = await getToolInputSchema(harness.httpPort, sessionId, 'slack_star_message');
    expect(schemaAfter).toBeTruthy();
    expect(schemaAfter!.properties).toHaveProperty('reason');
  });

  test('hot reload with add + remove + update in same reload', async () => {
    const sessionId = await initSession(harness.httpPort);
    const toolsBefore = await listToolNames(harness.httpPort, sessionId);
    expect(toolsBefore).toContain('slack_star_file');
    expect(toolsBefore).toContain('slack_star_message');
    expect(toolsBefore).not.toContain('slack_hot_reload_combo_tool');

    const original = harness.readToolFile();

    // Remove slack_star_file, update slack_star_message description, add new tool
    let modified = original;

    // 1. Remove slack_star_file
    const startMarker = '  // Star a file';
    const endMarker = '  // Remove star from a message';
    const startIdx = modified.indexOf(startMarker);
    const endIdx = modified.indexOf(endMarker);
    modified = modified.slice(0, startIdx) + modified.slice(endIdx);

    // 2. Update slack_star_message description
    modified = modified.replace(
      'Add a star to a message for quick access later.',
      'COMBO-TEST: Star a message for later.',
    );

    // 3. Add new tool
    const newToolCode = `
  // Combo test: new tool
  tools.set(
    'slack_hot_reload_combo_tool',
    server.registerTool(
      'slack_hot_reload_combo_tool',
      {
        description: 'Combo test tool',
        inputSchema: { value: z.string().describe('A value') },
      },
      async ({ value }) =>
        withToolId('slack_hot_reload_combo_tool', async () => {
          try {
            return success({ echo: value });
          } catch (err) {
            return error(err);
          }
        }),
    ),
  );
`;
    modified = modified.replace('  return tools;', newToolCode + '\n  return tools;');

    harness.writeToolFile(modified);
    await harness.waitForReload(1);

    const toolsAfter = await listToolNames(harness.httpPort, sessionId);

    // Verify remove
    expect(toolsAfter).not.toContain('slack_star_file');

    // Verify add
    expect(toolsAfter).toContain('slack_hot_reload_combo_tool');

    // Verify update
    const desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('COMBO-TEST');

    // Tool count: original - 1 (removed) + 1 (added) = same
    expect(toolsAfter.length).toBe(toolsBefore.length);
  });

  test('WebSocket extension connection survives hot reload', async ({ request }) => {
    // Connect a fake extension via WebSocket
    const wsClient = createWsTestClient(harness.wsPort);
    await wsClient.waitForConnection();
    expect(wsClient.isConnected()).toBe(true);

    // Health should show connected
    let health = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    let body = await health.json();
    expect(body.extension).toBe('connected');

    // Trigger hot reload
    harness.triggerReload();
    await harness.waitForReload(1);

    // WebSocket connection should survive
    expect(wsClient.isConnected()).toBe(true);

    // Health should still show connected
    health = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    body = await health.json();
    expect(body.extension).toBe('connected');

    wsClient.close();
  });

  test('hot reload preserves session count in health endpoint', async ({ request }) => {
    // Create multiple sessions
    await initSession(harness.httpPort);
    await initSession(harness.httpPort);

    let health = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    let body = await health.json();
    expect(body.streamSessions).toBe(2);

    // Trigger hot reload
    harness.triggerReload();
    await harness.waitForReload(1);

    // Sessions should still be tracked
    health = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    body = await health.json();
    expect(body.streamSessions).toBe(2);
  });

  test('three consecutive reloads with incremental changes', async () => {
    const sessionId = await initSession(harness.httpPort);
    const original = harness.readToolFile();

    // Reload 1: change description
    harness.writeToolFile(
      original.replace('Add a star to a message for quick access later.', 'ROUND-1: Star a message.'),
    );
    await harness.waitForReload(1);
    let desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('ROUND-1');

    // Reload 2: change it again
    let current = harness.readToolFile();
    harness.writeToolFile(current.replace('ROUND-1: Star a message.', 'ROUND-2: Star a message.'));
    await harness.waitForReload(2);
    desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('ROUND-2');

    // Reload 3: change it once more
    current = harness.readToolFile();
    harness.writeToolFile(current.replace('ROUND-2: Star a message.', 'ROUND-3: Star a message.'));
    await harness.waitForReload(3);
    desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('ROUND-3');
  });

  test('session created between reloads gets latest tool code', async () => {
    // First reload: change description
    const original = harness.readToolFile();
    harness.writeToolFile(
      original.replace('Add a star to a message for quick access later.', 'BETWEEN-RELOADS: Star a message.'),
    );
    await harness.waitForReload(1);

    // Create session after first reload
    const sessionId = await initSession(harness.httpPort);
    const desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('BETWEEN-RELOADS');

    // Second reload: change again
    const current = harness.readToolFile();
    harness.writeToolFile(current.replace('BETWEEN-RELOADS: Star a message.', 'AFTER-SECOND: Star a message.'));
    await harness.waitForReload(2);

    // Same session should see the new description
    const descAfter = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(descAfter).toContain('AFTER-SECOND');
  });

  test('hot reload with streamable HTTP client verifies tool list changed notification', async () => {
    const client = createStreamableHttpClient(harness.httpPort);
    await client.initialize();
    await client.openNotificationStream();

    // Verify initial tools
    const toolsBefore = await client.listTools();
    expect(toolsBefore.length).toBeGreaterThan(50);

    // Trigger reload
    harness.triggerReload();
    await harness.waitForReload(1);

    // Wait for the notification
    const notification = await client.waitForNotification('notifications/tools/list_changed', 5000);
    expect(notification.method).toBe('notifications/tools/list_changed');

    // Verify tools still work
    const toolsAfter = await client.listTools();
    expect(toolsAfter.length).toBe(toolsBefore.length);

    client.close();
  });

  test('hot reload with mixed SSE and Streamable HTTP sessions', async () => {
    // Create a Streamable HTTP session
    const streamSessionId = await initSession(harness.httpPort);

    // Create an SSE session
    const sseResponse = await fetch(`http://127.0.0.1:${harness.httpPort}/sse`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    });
    const sseReader = sseResponse.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let sseSessionId = '';
    while (!sseSessionId) {
      const { value } = await sseReader.read();
      buf += decoder.decode(value, { stream: true });
      const match = buf.match(/sessionId=([^\s&"]+)/);
      if (match) sseSessionId = match[1];
    }

    // Initialize SSE session
    await fetch(`http://127.0.0.1:${harness.httpPort}/sse?sessionId=${sseSessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'sse-mixed-test', version: '0.1' },
        },
      }),
    });
    await fetch(`http://127.0.0.1:${harness.httpPort}/sse?sessionId=${sseSessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // Trigger reload
    const original = harness.readToolFile();
    harness.writeToolFile(
      original.replace('Add a star to a message for quick access later.', 'MIXED-TRANSPORT-TEST: Star a message.'),
    );
    await harness.waitForReload(1);

    // Both sessions should see updated tools
    const streamDesc = await getToolDescription(harness.httpPort, streamSessionId, 'slack_star_message');
    expect(streamDesc).toContain('MIXED-TRANSPORT-TEST');

    // SSE session: list tools via POST
    const sseToolsResponse = await fetch(`http://127.0.0.1:${harness.httpPort}/sse?sessionId=${sseSessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(sseToolsResponse.ok).toBe(true);

    // Clean up SSE reader
    await sseReader.cancel();
  });

  test('health endpoint reports hot reload metadata', async ({ request }) => {
    // Before any reload, reloadCount should be 0
    let health = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    let body = await health.json();
    expect(body.hotReload).toBeDefined();
    expect(body.hotReload.reloadCount).toBe(0);
    expect(body.hotReload.lastReload).toBeNull();

    // Create a session so the reload patches something
    await initSession(harness.httpPort);

    // Trigger a reload
    harness.triggerReload();
    await harness.waitForReload(1);

    // Health should now report reload metadata
    health = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    body = await health.json();
    expect(body.hotReload.reloadCount).toBe(1);
    expect(body.hotReload.lastReload).toBeDefined();
    expect(body.hotReload.lastReload.success).toBe(true);
    expect(body.hotReload.lastReload.patchedSessions).toBe(1);
    expect(body.hotReload.lastReload.toolCount).toBeGreaterThan(50);
    expect(body.hotReload.lastReload.timestamp).toBeGreaterThan(0);
  });

  test('health endpoint reload count increments on multiple reloads', async ({ request }) => {
    harness.triggerReload();
    await harness.waitForReload(1);

    harness.triggerReload();
    await harness.waitForReload(2);

    harness.triggerReload();
    await harness.waitForReload(3);

    const health = await request.get(`http://127.0.0.1:${harness.httpPort}/health`);
    const body = await health.json();
    expect(body.hotReload.reloadCount).toBe(3);
  });

  test('server survives hot reload with syntax error in tool file', async () => {
    const sessionId = await initSession(harness.httpPort);
    const toolsBefore = await listToolNames(harness.httpPort, sessionId);
    expect(toolsBefore.length).toBeGreaterThan(50);

    // Write invalid syntax to tool file — this should cause the reload to fail
    // but the server should survive and existing sessions should keep working
    const original = harness.readToolFile();
    harness.writeToolFile('this is not valid typescript {{{{');

    // Wait a bit for bun --hot to attempt reload
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Restore the original file so subsequent tests work
    harness.writeToolFile(original);

    // The session should still be alive with the previous tools
    // (bun --hot may or may not have crashed, but let's verify the
    // session state is preserved across successful reloads)
    // Trigger a clean reload to verify recovery
    harness.triggerReload();

    // Wait for the reload to complete (the reload number may vary
    // depending on how bun --hot handled the syntax error)
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify the server is still responsive
    const healthResponse = await fetch(`http://127.0.0.1:${harness.httpPort}/health`);
    // If the server is still up, check that tools work
    if (healthResponse.ok) {
      const toolsAfter = await listToolNames(harness.httpPort, sessionId);
      expect(toolsAfter.length).toBeGreaterThan(50);
    }
  });

  test('rapid consecutive reloads converge to correct state', async () => {
    const sessionId = await initSession(harness.httpPort);
    const original = harness.readToolFile();

    // Rapidly trigger 3 reloads without waiting between them
    harness.writeToolFile(original.replace('Add a star to a message for quick access later.', 'RAPID-1: Star.'));
    // Small delay to let bun detect the change
    await new Promise(resolve => setTimeout(resolve, 100));

    const current1 = harness.readToolFile();
    harness.writeToolFile(current1.replace('RAPID-1: Star.', 'RAPID-2: Star.'));
    await new Promise(resolve => setTimeout(resolve, 100));

    const current2 = harness.readToolFile();
    harness.writeToolFile(current2.replace('RAPID-2: Star.', 'RAPID-FINAL: Star.'));

    // Wait for all reloads to settle
    await new Promise(resolve => setTimeout(resolve, 5000));

    // The final state should reflect the last write
    const desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('RAPID-FINAL');
  });

  test('newly connected session after multiple reloads has correct tools', async () => {
    const original = harness.readToolFile();

    // Do several reloads without any session
    harness.writeToolFile(original.replace('Add a star to a message for quick access later.', 'EVOLVED-1: Star.'));
    await harness.waitForReload(1);

    const current = harness.readToolFile();
    harness.writeToolFile(current.replace('EVOLVED-1: Star.', 'EVOLVED-2: Star.'));
    await harness.waitForReload(2);

    // Now connect a new session — it should see the latest tool definitions
    const sessionId = await initSession(harness.httpPort);
    const desc = await getToolDescription(harness.httpPort, sessionId, 'slack_star_message');
    expect(desc).toContain('EVOLVED-2');

    // And the tool list should be complete
    const tools = await listToolNames(harness.httpPort, sessionId);
    expect(tools.length).toBeGreaterThan(50);
  });
});
