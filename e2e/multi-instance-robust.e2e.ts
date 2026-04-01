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
