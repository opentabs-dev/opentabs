/**
 * Multi-instance robustness E2E tests — verify port-aware instance routing,
 * hot-reload, tab lifecycle, stress dispatch, and edge cases for the
 * multi-instance plugin feature.
 *
 * Unlike multi-instance.e2e.ts (which uses localhost vs 127.0.0.1 to
 * distinguish instances), these tests exercise same-hostname-different-port
 * scenarios — the most common real-world pattern for self-hosted services.
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
  readTestConfig,
  startMcpServer,
  startTestServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  openTestAppTab,
  setupAdapterSymlink,
  waitFor,
  waitForExtensionConnected,
  waitForLog,
  waitForToolList,
} from './helpers.js';

/** Shape of plugin_list_tabs response entries. */
interface PluginTabsEntry {
  plugin: string;
  displayName: string;
  state: string;
  tabs: Array<{ tabId: number; url: string; title: string; ready: boolean; instance?: string }>;
}

// ---------------------------------------------------------------------------
// Shared infrastructure for same-host multi-instance tests
// ---------------------------------------------------------------------------

interface SameHostTestContext {
  configDir: string;
  server: McpServer;
  alphaServer: TestServer;
  betaServer: TestServer;
  context: Awaited<ReturnType<typeof launchExtensionContext>>['context'];
  cleanupDir: string;
  client: McpClient;
  alphaUrl: string;
  betaUrl: string;
}

/**
 * Set up a same-host, different-port multi-instance test environment:
 * 1. Start two test servers on ephemeral ports (both on localhost)
 * 2. Write config.json with multi-instance url settings using both ports
 * 3. Start MCP server, extension, and MCP client
 */
const setupSameHostTest = async (): Promise<SameHostTestContext> => {
  const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
  const prefixedToolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const t of prefixedToolNames) {
    tools[t] = true;
  }

  const alphaServer = await startTestServer();
  const betaServer = await startTestServer();

  // Both servers are on localhost, distinguished only by port
  const alphaUrl = alphaServer.url; // http://localhost:<portA>
  const betaUrl = betaServer.url; // http://localhost:<portB>

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-robust-'));
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
    alphaUrl,
    betaUrl,
  };
};

const cleanupSameHostTest = async (ctx: SameHostTestContext): Promise<void> => {
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

/**
 * Open a tab and wait for adapter injection.
 */
const openTabAndWaitForAdapter = async (
  context: SameHostTestContext['context'],
  url: string,
  mcpServer: McpServer,
  testServer: TestServer,
): Promise<Awaited<ReturnType<typeof openTestAppTab>>> => openTestAppTab(context, url, mcpServer, testServer);

// ---------------------------------------------------------------------------
// Single-instance test infrastructure
// ---------------------------------------------------------------------------

interface SingleInstanceTestContext {
  configDir: string;
  server: McpServer;
  testServer: TestServer;
  context: Awaited<ReturnType<typeof launchExtensionContext>>['context'];
  cleanupDir: string;
  client: McpClient;
  serverUrl: string;
}

/**
 * Set up a single-instance test environment:
 * 1. Start one test server on an ephemeral port
 * 2. Write config.json with a single url-type instance
 * 3. Start MCP server, extension, and MCP client
 */
const setupSingleInstanceTest = async (): Promise<SingleInstanceTestContext> => {
  const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
  const prefixedToolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const t of prefixedToolNames) {
    tools[t] = true;
  }

  const testServer = await startTestServer();
  const serverUrl = testServer.url; // http://localhost:<port>

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-single-instance-'));
  writeTestConfig(configDir, {
    localPlugins: [absPluginPath],
    tools,
    settings: {
      'e2e-test': {
        instanceUrl: {
          default: serverUrl,
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
    testServer,
    context: ext.context,
    cleanupDir: ext.cleanupDir,
    client,
    serverUrl,
  };
};

const cleanupSingleInstanceTest = async (ctx: SingleInstanceTestContext): Promise<void> => {
  await ctx.client.close();
  await ctx.context.close().catch(() => {});
  await ctx.testServer.kill();
  await ctx.server.kill();
  fs.rmSync(ctx.cleanupDir, { recursive: true, force: true });
  cleanupTestConfigDir(ctx.configDir);
};

// ---------------------------------------------------------------------------
// US-006: Same-host-different-port dispatch
// ---------------------------------------------------------------------------

test.describe('Multi-instance robust — same host different ports', () => {
  test('dispatch to alpha hits server A, dispatch to beta hits server B', async () => {
    test.slow();
    let ctx: SameHostTestContext | undefined;
    try {
      ctx = await setupSameHostTest();

      // Open alpha tab
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);

      // Open beta tab
      const betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      const plugins = await waitForReadyTabs(ctx.client, 2);
      const entry = plugins[0];
      if (!entry) throw new Error('Expected plugin entry in plugin_list_tabs response');

      // Verify both tabs appear with correct instance labels
      expect(entry.plugin).toBe('e2e-test');
      expect(entry.tabs.length).toBe(2);

      const alphaTab = entry.tabs.find(t => t.instance === 'alpha');
      const betaTab = entry.tabs.find(t => t.instance === 'beta');
      expect(alphaTab).toBeDefined();
      expect(betaTab).toBeDefined();

      // Both on localhost but different ports
      expect(alphaTab?.url).toContain(`localhost:${String(ctx.alphaServer.port)}`);
      expect(betaTab?.url).toContain(`localhost:${String(ctx.betaServer.port)}`);

      // Dispatch echo to alpha — verify it hits alphaServer only
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();
      const alphaResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'hello-alpha-port',
        instance: 'alpha',
      });
      expect(alphaResult.isError).toBe(false);
      const alphaParsed = JSON.parse(alphaResult.content) as { message: string };
      expect(alphaParsed.message).toBe('hello-alpha-port');

      const alphaInvocations = await ctx.alphaServer.invocations();
      const alphaEchoes = alphaInvocations.filter(i => i.path === '/api/echo');
      expect(alphaEchoes.length).toBe(1);

      const betaInvocations = await ctx.betaServer.invocations();
      const betaEchoes = betaInvocations.filter(i => i.path === '/api/echo');
      expect(betaEchoes.length).toBe(0);

      // Dispatch echo to beta — verify it hits betaServer only
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();
      const betaResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'hello-beta-port',
        instance: 'beta',
      });
      expect(betaResult.isError).toBe(false);
      const betaParsed = JSON.parse(betaResult.content) as { message: string };
      expect(betaParsed.message).toBe('hello-beta-port');

      const betaInvocations2 = await ctx.betaServer.invocations();
      const betaEchoes2 = betaInvocations2.filter(i => i.path === '/api/echo');
      expect(betaEchoes2.length).toBe(1);

      const alphaInvocations2 = await ctx.alphaServer.invocations();
      const alphaEchoes2 = alphaInvocations2.filter(i => i.path === '/api/echo');
      expect(alphaEchoes2.length).toBe(0);

      // Verify getConfig returns the correct port-specific URL in each tab
      const alphaConfigResult = await ctx.client.callTool('e2e-test_sdk_get_config', {
        key: 'instanceUrl',
        instance: 'alpha',
      });
      expect(alphaConfigResult.isError).toBe(false);
      const alphaConfig = JSON.parse(alphaConfigResult.content) as { key: string; value: string | null };
      expect(alphaConfig.value).toBe(ctx.alphaUrl);

      const betaConfigResult = await ctx.client.callTool('e2e-test_sdk_get_config', {
        key: 'instanceUrl',
        instance: 'beta',
      });
      expect(betaConfigResult.isError).toBe(false);
      const betaConfig = JSON.parse(betaConfigResult.content) as { key: string; value: string | null };
      expect(betaConfig.value).toBe(ctx.betaUrl);

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupSameHostTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// US-007: Single-instance seamless (no instance parameter needed)
// ---------------------------------------------------------------------------

test.describe('Multi-instance robust — single instance seamless', () => {
  test('single instance works without instance parameter and schema omits instance enum', async () => {
    test.slow();
    let ctx: SingleInstanceTestContext | undefined;
    try {
      ctx = await setupSingleInstanceTest();

      // List tools — verify e2e-test_echo does NOT have an instance property
      const tools = await ctx.client.listTools();
      const echoTool = tools.find(t => t.name === 'e2e-test_echo');
      expect(echoTool).toBeDefined();

      const schema = echoTool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.properties?.instance).toBeUndefined();
      expect(schema.required ?? []).not.toContain('instance');
      // tabId should still be present
      expect(schema.properties?.tabId).toBeDefined();

      // Open one tab to the test server
      const page = await openTabAndWaitForAdapter(ctx.context, ctx.serverUrl, ctx.server, ctx.testServer);

      // Wait for the tab to be ready
      await waitForReadyTabs(ctx.client, 1);

      // Dispatch echo without instance parameter — should succeed
      await ctx.testServer.reset();
      const echoResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'hello-single',
      });
      expect(echoResult.isError).toBe(false);
      const echoParsed = JSON.parse(echoResult.content) as { message: string };
      expect(echoParsed.message).toBe('hello-single');

      // Verify test server received the call
      const invocations = await ctx.testServer.invocations();
      const echoes = invocations.filter(i => i.path === '/api/echo');
      expect(echoes.length).toBe(1);

      // getConfig('instanceUrl') should return the URL as a string (not a map)
      const configResult = await ctx.client.callTool('e2e-test_sdk_get_config', {
        key: 'instanceUrl',
      });
      expect(configResult.isError).toBe(false);
      const config = JSON.parse(configResult.content) as { key: string; value: string | null };
      expect(config.key).toBe('instanceUrl');
      expect(config.value).toBe(ctx.serverUrl);

      await page.close();
    } finally {
      if (ctx) await cleanupSingleInstanceTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// US-008: Hot-reload instance addition and removal
// ---------------------------------------------------------------------------

/** POST /reload with Bearer auth. */
const triggerReload = async (port: number, secret: string | undefined): Promise<Response> => {
  const headers: Record<string, string> = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return fetch(`http://localhost:${String(port)}/reload`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(10_000),
  });
};

test.describe('Multi-instance robust — hot-reload instance addition', () => {
  test('adding a third instance via config + POST /reload makes it dispatchable', async () => {
    test.slow();
    let ctx: SameHostTestContext | undefined;
    let gammaServer: TestServer | undefined;
    try {
      ctx = await setupSameHostTest();

      // Open alpha and beta tabs
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);
      const betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);
      await waitForReadyTabs(ctx.client, 2);

      // Verify initial tool schema has instance enum with alpha + beta
      const toolsBefore = await ctx.client.listTools();
      const echoToolBefore = toolsBefore.find(t => t.name === 'e2e-test_echo');
      expect(echoToolBefore).toBeDefined();
      const schemaBefore = echoToolBefore?.inputSchema as {
        properties?: Record<string, { enum?: string[] }>;
      };
      const instanceEnumBefore = schemaBefore.properties?.instance?.enum ?? [];
      expect(instanceEnumBefore).toContain('alpha');
      expect(instanceEnumBefore).toContain('beta');
      expect(instanceEnumBefore).not.toContain('gamma');

      // Start a third test server (gamma)
      gammaServer = await startTestServer();
      const gammaUrl = gammaServer.url;

      // Rewrite config.json adding gamma instance
      const config = readTestConfig(ctx.configDir);
      const settings = config.settings?.['e2e-test'] as Record<string, unknown>;
      const instanceUrlMap = settings.instanceUrl as Record<string, string>;
      instanceUrlMap.gamma = gammaUrl;
      writeTestConfig(ctx.configDir, config);

      // POST /reload to trigger config rediscovery
      const reloadRes = await triggerReload(ctx.server.port, ctx.server.secret);
      expect(reloadRes.ok).toBe(true);

      // Wait for tool list to reflect the gamma instance in the enum
      const toolsAfter = await waitForToolList(
        ctx.client,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          if (!echo) return false;
          const schema = echo.inputSchema as {
            properties?: Record<string, { enum?: string[] }>;
          };
          const instanceEnum = schema.properties?.instance?.enum ?? [];
          return instanceEnum.includes('gamma');
        },
        15_000,
        500,
        'instance enum to include gamma after reload',
      );

      // Verify all three instances are in the enum
      const echoToolAfter = toolsAfter.find(t => t.name === 'e2e-test_echo');
      const schemaAfter = echoToolAfter?.inputSchema as {
        properties?: Record<string, { enum?: string[] }>;
      };
      const instanceEnumAfter = schemaAfter.properties?.instance?.enum ?? [];
      expect(instanceEnumAfter).toContain('alpha');
      expect(instanceEnumAfter).toContain('beta');
      expect(instanceEnumAfter).toContain('gamma');

      // Open gamma tab
      const gammaPage = await openTabAndWaitForAdapter(ctx.context, gammaUrl, ctx.server, gammaServer);
      await waitForReadyTabs(ctx.client, 3);

      // Dispatch to gamma — verify it hits the gamma server
      await gammaServer.reset();
      const gammaResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'hello-gamma',
        instance: 'gamma',
      });
      expect(gammaResult.isError).toBe(false);
      const gammaParsed = JSON.parse(gammaResult.content) as { message: string };
      expect(gammaParsed.message).toBe('hello-gamma');

      const gammaInvocations = await gammaServer.invocations();
      const gammaEchoes = gammaInvocations.filter(i => i.path === '/api/echo');
      expect(gammaEchoes.length).toBe(1);

      await alphaPage.close();
      await betaPage.close();
      await gammaPage.close();
    } finally {
      if (gammaServer) await gammaServer.kill();
      if (ctx) await cleanupSameHostTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-host test infrastructure (localhost vs 127.0.0.1)
// ---------------------------------------------------------------------------

interface CrossHostTestContext {
  configDir: string;
  server: McpServer;
  alphaServer: TestServer;
  betaServer: TestServer;
  context: Awaited<ReturnType<typeof launchExtensionContext>>['context'];
  cleanupDir: string;
  client: McpClient;
  alphaUrl: string;
  betaUrl: string;
}

/**
 * Set up a cross-host multi-instance test environment:
 * alpha on localhost, beta on 127.0.0.1 (same server, different hostnames).
 */
const setupCrossHostTest = async (): Promise<CrossHostTestContext> => {
  const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
  const prefixedToolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const t of prefixedToolNames) {
    tools[t] = true;
  }

  const alphaServer = await startTestServer();
  const betaServer = await startTestServer();

  const alphaUrl = alphaServer.url; // http://localhost:<portA>
  const betaUrl = betaServer.url.replace('localhost', '127.0.0.1'); // http://127.0.0.1:<portB>

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-crosshost-'));
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
    alphaUrl,
    betaUrl,
  };
};

const cleanupCrossHostTest = async (ctx: CrossHostTestContext): Promise<void> => {
  await ctx.client.close();
  await ctx.context.close().catch(() => {});
  await ctx.alphaServer.kill();
  await ctx.betaServer.kill();
  await ctx.server.kill();
  fs.rmSync(ctx.cleanupDir, { recursive: true, force: true });
  cleanupTestConfigDir(ctx.configDir);
};

test.describe('Multi-instance robust — hot-reload instance removal', () => {
  test('removing an instance via config + POST /reload returns Unknown instance error', async () => {
    test.slow();
    let ctx: SameHostTestContext | undefined;
    try {
      ctx = await setupSameHostTest();

      // Open alpha and beta tabs
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);
      const betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);
      await waitForReadyTabs(ctx.client, 2);

      // Verify initial tool schema has instance enum with alpha + beta
      const toolsBefore = await ctx.client.listTools();
      const echoToolBefore = toolsBefore.find(t => t.name === 'e2e-test_echo');
      expect(echoToolBefore).toBeDefined();
      const schemaBefore = echoToolBefore?.inputSchema as {
        properties?: Record<string, { enum?: string[] }>;
      };
      const instanceEnumBefore = schemaBefore.properties?.instance?.enum ?? [];
      expect(instanceEnumBefore).toContain('alpha');
      expect(instanceEnumBefore).toContain('beta');

      // Rewrite config.json removing beta instance
      const config = readTestConfig(ctx.configDir);
      const settings = config.settings?.['e2e-test'] as Record<string, unknown>;
      const instanceUrlMap = settings.instanceUrl as Record<string, string>;
      delete instanceUrlMap.beta;
      writeTestConfig(ctx.configDir, config);

      // POST /reload to trigger config rediscovery
      const reloadRes = await triggerReload(ctx.server.port, ctx.server.secret);
      expect(reloadRes.ok).toBe(true);

      // Wait for tool list to reflect only alpha (no instance enum at all,
      // since a single instance means no instance parameter)
      await waitForToolList(
        ctx.client,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          if (!echo) return false;
          const schema = echo.inputSchema as {
            properties?: Record<string, { enum?: string[] }>;
          };
          // Single instance: no instance property in schema
          return schema.properties?.instance === undefined;
        },
        15_000,
        500,
        'instance parameter to be removed after reload (single instance)',
      );

      // Dispatch to beta — should return an Unknown instance error
      const betaResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'should-fail',
        instance: 'beta',
      });
      expect(betaResult.isError).toBe(true);
      expect(betaResult.content).toContain('Unknown instance');
      expect(betaResult.content).toContain('beta');

      // Dispatch to alpha should still work (without instance param, since
      // it's now the only instance)
      await ctx.alphaServer.reset();
      const alphaResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'hello-alpha-after-removal',
      });
      expect(alphaResult.isError).toBe(false);
      const alphaParsed = JSON.parse(alphaResult.content) as { message: string };
      expect(alphaParsed.message).toBe('hello-alpha-after-removal');

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupSameHostTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// US-009: tabId + instance conflict precedence
// ---------------------------------------------------------------------------

test.describe('Multi-instance robust — tabId + instance conflict precedence', () => {
  test('tabId takes precedence over instance when both are provided and disagree', async () => {
    test.slow();
    let ctx: CrossHostTestContext | undefined;
    try {
      ctx = await setupCrossHostTest();

      // Open alpha tab (localhost)
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);

      // Open beta tab (127.0.0.1)
      const betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      const plugins = await waitForReadyTabs(ctx.client, 2);
      const entry = plugins[0];
      if (!entry) throw new Error('Expected plugin entry in plugin_list_tabs response');

      // Get beta tab's tabId
      const betaTab = entry.tabs.find(t => t.instance === 'beta');
      expect(betaTab).toBeDefined();
      const betaTabId = betaTab?.tabId;
      expect(betaTabId).toBeDefined();

      // Reset invocation counters before the test call
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();

      // Dispatch with instance='alpha' AND tabId=<beta_tab_id>
      // tabId should take precedence — the call should hit beta's server
      const result = await ctx.client.callTool('e2e-test_echo', {
        message: 'tabid-wins',
        instance: 'alpha',
        tabId: betaTabId,
      });
      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content) as { message: string };
      expect(parsed.message).toBe('tabid-wins');

      // Beta server should have received the call (tabId won)
      const betaInvocations = await ctx.betaServer.invocations();
      const betaEchoes = betaInvocations.filter(i => i.path === '/api/echo');
      expect(betaEchoes.length).toBe(1);

      // Alpha server should NOT have received any call
      const alphaInvocations = await ctx.alphaServer.invocations();
      const alphaEchoes = alphaInvocations.filter(i => i.path === '/api/echo');
      expect(alphaEchoes.length).toBe(0);

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupCrossHostTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// US-010: Rapid sequential dispatch across instances
// ---------------------------------------------------------------------------

test.describe('Multi-instance robust — rapid sequential dispatch', () => {
  test('20 sequential calls alternate between alpha and beta with zero cross-routing', async () => {
    test.slow();
    let ctx: CrossHostTestContext | undefined;
    try {
      ctx = await setupCrossHostTest();

      // Open alpha tab (localhost)
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);

      // Open beta tab (127.0.0.1)
      const betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      await waitForReadyTabs(ctx.client, 2);

      // Reset invocation counters before the stress test
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();

      const totalCalls = 20;
      const results: Array<{ index: number; instance: string; message: string; response: string }> = [];

      // Fire 20 sequential echo calls: even indices → alpha, odd → beta
      for (let i = 0; i < totalCalls; i++) {
        const instance = i % 2 === 0 ? 'alpha' : 'beta';
        const message = `call-${String(i)}-${instance}`;

        const result = await ctx.client.callTool('e2e-test_echo', {
          message,
          instance,
        });

        expect(result.isError).toBe(false);
        const parsed = JSON.parse(result.content) as { message: string };
        expect(parsed.message).toBe(message);

        results.push({ index: i, instance, message, response: parsed.message });
      }

      // Verify all 20 calls returned correct responses
      expect(results.length).toBe(totalCalls);
      for (const r of results) {
        expect(r.response).toBe(r.message);
      }

      // Check invocation counts: alpha=10, beta=10
      const alphaInvocations = await ctx.alphaServer.invocations();
      const alphaEchoes = alphaInvocations.filter(i => i.path === '/api/echo');
      expect(alphaEchoes.length).toBe(10);

      const betaInvocations = await ctx.betaServer.invocations();
      const betaEchoes = betaInvocations.filter(i => i.path === '/api/echo');
      expect(betaEchoes.length).toBe(10);

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupCrossHostTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// US-011: Concurrent burst dispatch across instances
// ---------------------------------------------------------------------------

test.describe('Multi-instance robust — concurrent burst dispatch', () => {
  test('10 concurrent calls (5 alpha, 5 beta) via Promise.all route correctly', async () => {
    test.slow();
    let ctx: CrossHostTestContext | undefined;
    try {
      ctx = await setupCrossHostTest();

      // Open alpha tab (localhost)
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);

      // Open beta tab (127.0.0.1)
      const betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      await waitForReadyTabs(ctx.client, 2);

      // Reset invocation counters before the burst
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();

      // Build array of 10 promises: indices 0-4 → alpha, indices 5-9 → beta
      const { client } = ctx;
      const promises = Array.from({ length: 10 }, (_, i) => {
        const instance = i < 5 ? 'alpha' : 'beta';
        const message = `burst-${String(i)}-${instance}`;
        return client
          .callTool('e2e-test_echo', { message, instance })
          .then(result => ({ index: i, instance, message, result }));
      });

      const results = await Promise.all(promises);

      // Verify all 10 calls succeeded with correct responses
      for (const { message, result } of results) {
        expect(result.isError).toBe(false);
        const parsed = JSON.parse(result.content) as { message: string };
        expect(parsed.message).toBe(message);
      }

      // Check invocation counts: alpha=5, beta=5
      const alphaInvocations = await ctx.alphaServer.invocations();
      const alphaEchoes = alphaInvocations.filter(i => i.path === '/api/echo');
      expect(alphaEchoes.length).toBe(5);

      const betaInvocations = await ctx.betaServer.invocations();
      const betaEchoes = betaInvocations.filter(i => i.path === '/api/echo');
      expect(betaEchoes.length).toBe(5);

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupCrossHostTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// US-012: Instance tab close and reopen recovery
// ---------------------------------------------------------------------------

/**
 * Poll plugin_list_tabs until the e2e-test plugin reports exactly `count` tabs
 * (regardless of readiness). Returns the plugin entry list.
 */
const waitForTabCount = async (client: McpClient, count: number, timeoutMs = 20_000): Promise<PluginTabsEntry[]> => {
  let last: PluginTabsEntry[] = [];
  await waitFor(
    async () => {
      const result = await client.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
      if (result.isError) return false;
      last = JSON.parse(result.content) as PluginTabsEntry[];
      const entry = last[0];
      if (!entry) return count === 0;
      return entry.tabs.length === count;
    },
    timeoutMs,
    500,
    `plugin_list_tabs to report exactly ${String(count)} tab(s)`,
  );
  return last;
};

test.describe('Multi-instance robust — all instance tabs closed', () => {
  test('closing all tabs returns No open tab error and plugin_list_tabs shows closed state', async () => {
    test.slow();
    let ctx: CrossHostTestContext | undefined;
    try {
      ctx = await setupCrossHostTest();

      // Open alpha tab (localhost) and beta tab (127.0.0.1)
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);
      const betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      await waitForReadyTabs(ctx.client, 2);

      // Verify dispatch works before closing
      const alphaCheck = await ctx.client.callTool('e2e-test_echo', {
        message: 'pre-close-alpha',
        instance: 'alpha',
      });
      expect(alphaCheck.isError).toBe(false);

      const betaCheck = await ctx.client.callTool('e2e-test_echo', {
        message: 'pre-close-beta',
        instance: 'beta',
      });
      expect(betaCheck.isError).toBe(false);

      // Close both tabs
      await alphaPage.close();
      await betaPage.close();

      // Wait for tab mapping to reflect 0 tabs
      await waitForTabCount(ctx.client, 0);

      // Dispatch to alpha — should fail
      const alphaFailResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'should-fail-alpha',
        instance: 'alpha',
      });
      expect(alphaFailResult.isError).toBe(true);

      // Dispatch to beta — should fail
      const betaFailResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'should-fail-beta',
        instance: 'beta',
      });
      expect(betaFailResult.isError).toBe(true);

      // plugin_list_tabs should show closed state with empty tabs
      const listResult = await ctx.client.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
      expect(listResult.isError).toBe(false);
      const plugins = JSON.parse(listResult.content) as PluginTabsEntry[];
      const entry = plugins[0];
      expect(entry).toBeDefined();
      expect(entry?.state).toBe('closed');
      expect(entry?.tabs.length).toBe(0);
    } finally {
      if (ctx) await cleanupCrossHostTest(ctx);
    }
  });
});

test.describe('Multi-instance robust — tab close and reopen recovery', () => {
  test('closing beta tab causes dispatch error, reopening restores dispatch', async () => {
    test.slow();
    let ctx: CrossHostTestContext | undefined;
    try {
      ctx = await setupCrossHostTest();

      // Open alpha tab (localhost) and beta tab (127.0.0.1)
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);
      let betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      await waitForReadyTabs(ctx.client, 2);

      // Verify dispatch to both instances works
      await ctx.alphaServer.reset();
      await ctx.betaServer.reset();

      const alphaResult1 = await ctx.client.callTool('e2e-test_echo', {
        message: 'before-close-alpha',
        instance: 'alpha',
      });
      expect(alphaResult1.isError).toBe(false);

      const betaResult1 = await ctx.client.callTool('e2e-test_echo', {
        message: 'before-close-beta',
        instance: 'beta',
      });
      expect(betaResult1.isError).toBe(false);

      // Close beta tab
      await betaPage.close();

      // Wait for tab mapping to reflect only 1 tab (alpha)
      await waitForTabCount(ctx.client, 1);

      // Dispatch to beta — should fail with "No open tab" or similar error
      const betaFailResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'should-fail-beta',
        instance: 'beta',
      });
      expect(betaFailResult.isError).toBe(true);

      // Dispatch to alpha — should still work (isolated from beta closure)
      await ctx.alphaServer.reset();
      const alphaResult2 = await ctx.client.callTool('e2e-test_echo', {
        message: 'after-close-alpha',
        instance: 'alpha',
      });
      expect(alphaResult2.isError).toBe(false);
      const alphaParsed2 = JSON.parse(alphaResult2.content) as { message: string };
      expect(alphaParsed2.message).toBe('after-close-alpha');

      // Reopen beta tab
      betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready again
      await waitForReadyTabs(ctx.client, 2);

      // Dispatch to beta — should work again
      await ctx.betaServer.reset();
      const betaResult2 = await ctx.client.callTool('e2e-test_echo', {
        message: 'after-reopen-beta',
        instance: 'beta',
      });
      expect(betaResult2.isError).toBe(false);
      const betaParsed2 = JSON.parse(betaResult2.content) as { message: string };
      expect(betaParsed2.message).toBe('after-reopen-beta');

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupCrossHostTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// US-014: URL path and trailing slash variations in pattern derivation
// ---------------------------------------------------------------------------

test.describe('Multi-instance robust — URL path variations in pattern derivation', () => {
  test('config URL with path derives host:port pattern, dispatch works, getConfig returns original URL', async () => {
    test.slow();
    let ctx: SingleInstanceTestContext | undefined;
    try {
      ctx = await setupSingleInstanceTest();

      // Rewrite config to use a URL with a path (e.g., /grafana/)
      const configUrlWithPath = `${ctx.serverUrl}/grafana/`;

      const config = readTestConfig(ctx.configDir);
      const settings = config.settings?.['e2e-test'] as Record<string, unknown>;
      settings.instanceUrl = { main: configUrlWithPath };
      writeTestConfig(ctx.configDir, config);

      // POST /reload to pick up the config change
      const reloadRes = await triggerReload(ctx.server.port, ctx.server.secret);
      expect(reloadRes.ok).toBe(true);

      // Wait for the tool list to update (instance parameter should not be
      // present since there's only one instance)
      await waitForToolList(
        ctx.client,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          return echo !== undefined;
        },
        10_000,
        500,
        'tools to be available after reload',
      );

      // Open a tab to the root of the test server — the derived pattern
      // *://localhost:PORT/* matches any path on this host:port
      const page = await openTabAndWaitForAdapter(ctx.context, ctx.serverUrl, ctx.server, ctx.testServer);

      // Wait for the tab to be ready
      await waitForReadyTabs(ctx.client, 1);

      // Dispatch echo — should succeed (pattern matched the tab)
      await ctx.testServer.reset();
      const echoResult = await ctx.client.callTool('e2e-test_echo', {
        message: 'path-variation-test',
      });
      expect(echoResult.isError).toBe(false);
      const echoParsed = JSON.parse(echoResult.content) as { message: string };
      expect(echoParsed.message).toBe('path-variation-test');

      // getConfig('instanceUrl') should return the original URL with path
      const configResult = await ctx.client.callTool('e2e-test_sdk_get_config', {
        key: 'instanceUrl',
      });
      expect(configResult.isError).toBe(false);
      const configData = JSON.parse(configResult.content) as { key: string; value: string | null };
      expect(configData.key).toBe('instanceUrl');
      expect(configData.value).toBe(configUrlWithPath);

      await page.close();
    } finally {
      if (ctx) await cleanupSingleInstanceTest(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// US-015: Per-tab getConfig isolation under concurrent load
// ---------------------------------------------------------------------------

test.describe('Multi-instance robust — per-tab getConfig isolation under concurrent load', () => {
  test('10 concurrent getConfig calls (5 alpha, 5 beta) return correct URLs with no cross-contamination', async () => {
    test.slow();
    let ctx: CrossHostTestContext | undefined;
    try {
      ctx = await setupCrossHostTest();

      // Open alpha tab (localhost) and beta tab (127.0.0.1)
      const alphaPage = await openTabAndWaitForAdapter(ctx.context, ctx.alphaUrl, ctx.server, ctx.alphaServer);
      const betaPage = await openTabAndWaitForAdapter(ctx.context, ctx.betaUrl, ctx.server, ctx.betaServer);

      // Wait for both tabs to be ready
      await waitForReadyTabs(ctx.client, 2);

      // Build 10 concurrent getConfig calls: indices 0-4 → alpha, indices 5-9 → beta
      const { client, alphaUrl, betaUrl } = ctx;
      const promises = Array.from({ length: 10 }, (_, i) => {
        const instance = i < 5 ? 'alpha' : 'beta';
        return client
          .callTool('e2e-test_sdk_get_config', { key: 'instanceUrl', instance })
          .then(result => ({ index: i, instance, result }));
      });

      const results = await Promise.all(promises);

      // Verify all alpha calls return the alpha URL
      for (const { result } of results.filter(r => r.instance === 'alpha')) {
        expect(result.isError).toBe(false);
        const parsed = JSON.parse(result.content) as { key: string; value: string | null };
        expect(parsed.key).toBe('instanceUrl');
        expect(parsed.value).toBe(alphaUrl);
      }

      // Verify all beta calls return the beta URL
      for (const { result } of results.filter(r => r.instance === 'beta')) {
        expect(result.isError).toBe(false);
        const parsed = JSON.parse(result.content) as { key: string; value: string | null };
        expect(parsed.key).toBe('instanceUrl');
        expect(parsed.value).toBe(betaUrl);
      }

      await alphaPage.close();
      await betaPage.close();
    } finally {
      if (ctx) await cleanupCrossHostTest(ctx);
    }
  });
});
