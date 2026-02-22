/**
 * E2E tests for auto-derived tool displayName and default icon.
 *
 * Verifies that tools omitting displayName and icon get sensible defaults:
 *   - displayName auto-derived from snake_case name → Title Case
 *   - icon defaults to 'wrench'
 *
 * Tests both the build artifact (dist/tools.json) and the runtime behavior
 * (tool is callable, appears in tools/list and /health).
 */

import { test, expect, E2E_TEST_PLUGIN_DIR } from './fixtures.js';
import { setupToolTest, callToolExpectSuccess } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Build artifact verification
// ---------------------------------------------------------------------------

test.describe('Tool defaults — build artifact', () => {
  test('tools.json has auto-derived displayName and default icon for tool without explicit values', () => {
    const toolsJsonPath = path.join(E2E_TEST_PLUGIN_DIR, 'dist', 'tools.json');
    const manifest = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8')) as {
      tools: Array<{ name: string; displayName: string; icon: string }>;
    };

    const tool = manifest.tools.find(t => t.name === 'no_display_name');
    expect(tool).toBeDefined();

    // Auto-derived from snake_case: 'no_display_name' → 'No Display Name'
    expect(tool?.displayName).toBe('No Display Name');
    // Default icon when omitted
    expect(tool?.icon).toBe('wrench');
  });
});

// ---------------------------------------------------------------------------
// Runtime verification — full stack
// ---------------------------------------------------------------------------

test.describe('Tool defaults — runtime', () => {
  test('tool without explicit displayName/icon is discoverable and callable', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify the tool appears in MCP tools/list
    const tools = await mcpClient.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('e2e-test_no_display_name');

    // Verify the tool is callable through the full dispatch chain
    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_no_display_name', {});
    expect(output.ok).toBe(true);

    await page.close();
  });

  test('health endpoint includes tool with auto-derived defaults', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const health = await mcpServer.health();
    expect(health).not.toBeNull();

    const pluginDetails = health?.pluginDetails ?? [];
    const e2ePlugin = pluginDetails.find(p => p.name === 'e2e-test');
    expect(e2ePlugin).toBeDefined();
    expect(e2ePlugin?.toolCount).toBeGreaterThan(0);

    // The health endpoint returns prefixed tool names at runtime
    const pluginTools = (e2ePlugin as unknown as { tools: string[] }).tools;
    expect(pluginTools).toContain('e2e-test_no_display_name');

    await page.close();
  });
});
