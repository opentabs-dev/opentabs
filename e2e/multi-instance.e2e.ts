/**
 * Multi-instance plugin E2E tests — verify the complete multi-instance flow:
 *
 * - Configure a plugin with two url-type instances (alpha and beta on localhost, different ports)
 * - Verify both tabs appear in plugin_list_tabs with correct instance labels
 * - Verify dispatching with instance parameter hits the correct tab
 * - Verify dispatching with a non-existent instance returns an error
 * - Verify getConfig returns the per-tab URL in each instance
 * - Verify the instance parameter appears in tool schemas
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpClient, McpServer, TestServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  E2E_TEST_PLUGIN_DIR,
  expect,
  launchExtensionContext,
  readPluginToolNames,
  startMcpServer,
  startTestServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import { openTestAppTab, setupAdapterSymlink, waitFor, waitForExtensionConnected, waitForLog } from './helpers.js';

/** Shape of plugin_list_tabs response entries. */
interface PluginTabsEntry {
  plugin: string;
  displayName: string;
  state: string;
  tabs: Array<{ tabId: number; url: string; title: string; ready: boolean; instance?: string }>;
}

// ---------------------------------------------------------------------------
// Shared infrastructure for multi-instance tests
// ---------------------------------------------------------------------------

interface MultiInstanceTestContext {
  configDir: string;
  server: McpServer;
  alphaServer: TestServer;
  betaServer: TestServer;
  context: Awaited<ReturnType<typeof launchExtensionContext>>['context'];
  cleanupDir: string;
  client: McpClient;
}

/**
 * Set up the full multi-instance test environment:
 * 1. Start two test servers on localhost (different ports)
 * 2. Write config.json with multi-instance url settings
 * 3. Start MCP server, extension, and MCP client
 */
const setupMultiInstanceTest = async (): Promise<MultiInstanceTestContext> => {
  const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
  const prefixedToolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const t of prefixedToolNames) {
    tools[t] = true;
  }

  // Start two test servers on ephemeral ports
  const alphaServer = await startTestServer();
  const betaServer = await startTestServer();

  // Write config with multi-instance url settings.
  // Both on localhost with different ports — port-aware pattern derivation
  // distinguishes them via *://localhost:<portA>/* vs *://localhost:<portB>/*.
  const alphaUrl = alphaServer.url; // http://localhost:<portA>
  const betaUrl = betaServer.url; // http://localhost:<portB>

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-multi-instance-'));
  writeTestConfig(configDir, {
    localPlugins: [absPluginPath],
    tools,
    settings: {
      'e2e-test': {
        instanceUrl: {
          alpha: alphaUrl,
          beta: betaUrl,
        },
      },
    },
  });

  const server = await startMcpServer(configDir, true);
  const ext = await launchExtensionContext(server.port, server.secret);
  setupAdapterSymlink(configDir, ext.extensionDir);

  const client = createMcpClient(server.port, server.secret);
  await client.initialize();

  await waitForExtensionConnected(server);
  await waitForLog(server, 'plugin(s) mapped');

  return {
    configDir,
    server,
    alphaServer,
    betaServer,
    context: ext.context,
    cleanupDir: ext.cleanupDir,
    client,
  };
};

const cleanupMultiInstanceTest = async (ctx: MultiInstanceTestContext): Promise<void> => {
  await ctx.client.close();
  await ctx.context.close().catch(() => {});
  await ctx.alphaServer.kill();
  await ctx.betaServer.kill();
  await ctx.server.kill();
  fs.rmSync(ctx.cleanupDir, { recursive: true, force: true });
  cleanupTestConfigDir(ctx.configDir);
};

/**
 * Poll plugin_list_tabs until the e2e-test plugin reports at least `count` tabs
 * where all are ready.
 */
const waitForReadyTabs = async (client: McpClient, count: number, timeoutMs = 20_000): Promise<PluginTabsEntry[]> => {
  let last: PluginTabsEntry[] = [];
  await waitFor(
    async () => {
      const result = await client.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
      if (result.isError) return false;
      last = JSON.parse(result.content) as PluginTabsEntry[];
      const entry = last[0];
      return entry !== undefined && entry.tabs.length >= count && entry.tabs.every(t => t.ready);
    },
    timeoutMs,
    500,
    `plugin_list_tabs to report ${count} ready tab(s)`,
  );
  return last;
};

// ---------------------------------------------------------------------------
// Test 1: plugin_list_tabs shows instance labels
// ---------------------------------------------------------------------------

test.describe('Multi-instance — plugin_list_tabs instance labels', () => {
  test('both tabs appear with correct instance labels (alpha and beta)', async () => {
    test.slow();
    let ctx: MultiInstanceTestContext | undefined;
    try {
      ctx = await setupMultiInstanceTest();

      // Open alpha tab
      const alphaPage = await openTestAppTab(ctx.context, ctx.alphaServer.url, ctx.server, ctx.alphaServer);

      // Open beta tab
      const betaPage = await openTestAppTab(ctx.context, ctx.betaServer.url, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      const plugins = await waitForReadyTabs(ctx.client, 2);

      const entry = plugins[0];
      if (!entry) throw new Error('Expected plugin entry in plugin_list_tabs response');

      expect(entry.plugin).toBe('e2e-test');
      expect(entry.tabs.length).toBe(2);

      // Verify instance labels are present
      const alphaTab = entry.tabs.find(t => t.instance === 'alpha');
      const betaTab = entry.tabs.find(t => t.instance === 'beta');

      expect(alphaTab).toBeDefined();
      expect(betaTab).toBeDefined();
      expect(alphaTab?.url).toContain(`localhost:${String(ctx.alphaServer.port)}`);
      expect(betaTab?.url).toContain(`localhost:${String(ctx.betaServer.port)}`);

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupMultiInstanceTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: Dispatch with instance parameter targets the correct tab
// ---------------------------------------------------------------------------

test.describe('Multi-instance — instance dispatch', () => {
  test('dispatching with instance parameter hits the correct tab', async () => {
    test.slow();
    let ctx: MultiInstanceTestContext | undefined;
    try {
      ctx = await setupMultiInstanceTest();

      // Open alpha tab
      const alphaPage = await openTestAppTab(ctx.context, ctx.alphaServer.url, ctx.server, ctx.alphaServer);

      // Open beta tab
      const betaPage = await openTestAppTab(ctx.context, ctx.betaServer.url, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      await waitForReadyTabs(ctx.client, 2);

      // Dispatch echo to alpha instance — should hit alphaServer
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();
      const alphaResult = await ctx.client.callTool('e2e-test__echo', {
        message: 'hello-alpha',
        instance: 'alpha',
      });
      expect(alphaResult.isError).toBe(false);
      const alphaParsed = JSON.parse(alphaResult.content) as { message: string };
      expect(alphaParsed.message).toBe('hello-alpha');

      // Verify alphaServer received the echo, betaServer did not
      const alphaInvocations = await ctx.alphaServer.invocations();
      const alphaEchoes = alphaInvocations.filter(i => i.path === '/api/echo');
      expect(alphaEchoes.length).toBe(1);

      const betaInvocations = await ctx.betaServer.invocations();
      const betaEchoes = betaInvocations.filter(i => i.path === '/api/echo');
      expect(betaEchoes.length).toBe(0);

      // Now dispatch echo to beta instance — should hit betaServer
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();
      const betaResult = await ctx.client.callTool('e2e-test__echo', {
        message: 'hello-beta',
        instance: 'beta',
      });
      expect(betaResult.isError).toBe(false);
      const betaParsed = JSON.parse(betaResult.content) as { message: string };
      expect(betaParsed.message).toBe('hello-beta');

      // Verify betaServer received the echo, alphaServer did not
      const betaInvocations2 = await ctx.betaServer.invocations();
      const betaEchoes2 = betaInvocations2.filter(i => i.path === '/api/echo');
      expect(betaEchoes2.length).toBe(1);

      const alphaInvocations2 = await ctx.alphaServer.invocations();
      const alphaEchoes2 = alphaInvocations2.filter(i => i.path === '/api/echo');
      expect(alphaEchoes2.length).toBe(0);

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupMultiInstanceTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: Dispatch with non-existent instance returns error
// ---------------------------------------------------------------------------

test.describe('Multi-instance — unknown instance error', () => {
  test('dispatching with non-existent instance returns an error listing valid instances', async () => {
    test.slow();
    let ctx: MultiInstanceTestContext | undefined;
    try {
      ctx = await setupMultiInstanceTest();

      // Open alpha tab so the plugin is available
      const alphaPage = await openTestAppTab(ctx.context, ctx.alphaServer.url, ctx.server, ctx.alphaServer);
      await waitForReadyTabs(ctx.client, 1);

      // Call with a non-existent instance name
      const result = await ctx.client.callTool('e2e-test__echo', {
        message: 'should-fail',
        instance: 'gamma',
      });

      expect(result.isError).toBe(true);
      // Error should mention the invalid instance and list valid ones
      expect(result.content).toContain('gamma');
      expect(result.content).toContain('alpha');
      expect(result.content).toContain('beta');

      await alphaPage.close();
    } finally {
      if (ctx) await cleanupMultiInstanceTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: getConfig returns per-tab URL in each instance
// ---------------------------------------------------------------------------

test.describe('Multi-instance — per-tab getConfig', () => {
  test('getConfig returns the correct per-instance URL in each tab', async () => {
    test.slow();
    let ctx: MultiInstanceTestContext | undefined;
    try {
      ctx = await setupMultiInstanceTest();

      // Open alpha tab
      const alphaPage = await openTestAppTab(ctx.context, ctx.alphaServer.url, ctx.server, ctx.alphaServer);

      // Open beta tab
      const betaPage = await openTestAppTab(ctx.context, ctx.betaServer.url, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      await waitForReadyTabs(ctx.client, 2);

      // Call sdk_get_config targeting the alpha instance
      const alphaConfigResult = await ctx.client.callTool('e2e-test__sdk_get_config', {
        key: 'instanceUrl',
        instance: 'alpha',
      });
      expect(alphaConfigResult.isError).toBe(false);
      const alphaConfig = JSON.parse(alphaConfigResult.content) as {
        key: string;
        value: string | null;
      };
      expect(alphaConfig.key).toBe('instanceUrl');
      expect(alphaConfig.value).toBe(ctx.alphaServer.url);

      // Call sdk_get_config targeting the beta instance
      const betaConfigResult = await ctx.client.callTool('e2e-test__sdk_get_config', {
        key: 'instanceUrl',
        instance: 'beta',
      });
      expect(betaConfigResult.isError).toBe(false);
      const betaConfig = JSON.parse(betaConfigResult.content) as {
        key: string;
        value: string | null;
      };
      expect(betaConfig.key).toBe('instanceUrl');
      expect(betaConfig.value).toBe(ctx.betaServer.url);

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupMultiInstanceTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5: Tool schemas include instance enum parameter
// ---------------------------------------------------------------------------

test.describe('Multi-instance — tool schema injection', () => {
  test('plugin tools have an instance enum parameter when multiple instances are configured', async () => {
    test.slow();
    let ctx: MultiInstanceTestContext | undefined;
    try {
      ctx = await setupMultiInstanceTest();

      // List tools and find an e2e-test tool
      const tools = await ctx.client.listTools();
      const echoTool = tools.find(t => t.name === 'e2e-test__echo');
      expect(echoTool).toBeDefined();

      const schema = echoTool?.inputSchema as {
        properties?: Record<string, { type?: string; enum?: string[] }>;
        required?: string[];
      };
      expect(schema.properties?.instance).toBeDefined();
      expect(schema.properties?.instance?.type).toBe('string');
      expect(schema.properties?.instance?.enum).toContain('alpha');
      expect(schema.properties?.instance?.enum).toContain('beta');
      // instance should be required
      expect(schema.required).toContain('instance');
      // tabId should still be present
      expect(schema.properties?.tabId).toBeDefined();
    } finally {
      if (ctx) await cleanupMultiInstanceTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6: Concurrent dispatch to alpha and beta — no cross-routing
// ---------------------------------------------------------------------------

test.describe('Multi-instance — concurrent dispatch no cross-routing', () => {
  test('concurrent echo calls route to correct instances with no cross-contamination', async () => {
    test.slow();
    let ctx: MultiInstanceTestContext | undefined;
    try {
      ctx = await setupMultiInstanceTest();

      // Open alpha tab
      const alphaPage = await openTestAppTab(ctx.context, ctx.alphaServer.url, ctx.server, ctx.alphaServer);

      // Open beta tab
      const betaPage = await openTestAppTab(ctx.context, ctx.betaServer.url, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      await waitForReadyTabs(ctx.client, 2);

      // Reset invocation counters before the concurrent calls
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();

      // Fire concurrent echo calls — one to alpha, one to beta via Promise.all
      const [alphaResult, betaResult] = await Promise.all([
        ctx.client.callTool('e2e-test__echo', {
          message: 'from-alpha',
          instance: 'alpha',
        }),
        ctx.client.callTool('e2e-test__echo', {
          message: 'from-beta',
          instance: 'beta',
        }),
      ]);

      // Both calls succeed
      expect(alphaResult.isError).toBe(false);
      expect(betaResult.isError).toBe(false);

      // Verify alpha server received exactly 1 echo with the correct message
      const alphaInvocations = await ctx.alphaServer.invocations();
      const alphaEchoes = alphaInvocations.filter(i => i.path === '/api/echo');
      expect(alphaEchoes.length).toBe(1);
      const alphaBody = alphaEchoes[0]?.body as { message?: string } | undefined;
      expect(alphaBody?.message).toBe('from-alpha');

      // Verify beta server received exactly 1 echo with the correct message
      const betaInvocations = await ctx.betaServer.invocations();
      const betaEchoes = betaInvocations.filter(i => i.path === '/api/echo');
      expect(betaEchoes.length).toBe(1);
      const betaBody = betaEchoes[0]?.body as { message?: string } | undefined;
      expect(betaBody?.message).toBe('from-beta');

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupMultiInstanceTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 7: Dispatch with instance when that tab is not open returns error
// ---------------------------------------------------------------------------

test.describe('Multi-instance — missing instance tab', () => {
  test('dispatching to an instance whose tab is not open returns an error', async () => {
    test.slow();
    let ctx: MultiInstanceTestContext | undefined;
    try {
      ctx = await setupMultiInstanceTest();

      // Only open alpha tab — beta tab is NOT open
      const alphaPage = await openTestAppTab(ctx.context, ctx.alphaServer.url, ctx.server, ctx.alphaServer);
      await waitForReadyTabs(ctx.client, 1);

      // Dispatch to beta instance — should fail because no beta tab is open
      const result = await ctx.client.callTool('e2e-test__echo', {
        message: 'should-fail',
        instance: 'beta',
      });

      expect(result.isError).toBe(true);
      // Error should mention the missing instance
      expect(result.content).toContain('beta');
      expect(result.content.toLowerCase()).toContain('no open tab');

      await alphaPage.close();
    } finally {
      if (ctx) await cleanupMultiInstanceTest(ctx);
    }
  });
});
