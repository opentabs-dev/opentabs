/**
 * Pre-script E2E tests — verifies that the document_start MAIN-world content
 * script captures a bearer token from fetch() before the page can overwrite
 * window.fetch, using the prescript-test plugin and prescript-mock-server.
 *
 * Uses the plain Playwright `test` (not fixture-based) because the test needs
 * to spawn a bespoke mock server in addition to the standard infrastructure.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupTestConfigDir,
  createMcpClient,
  launchExtensionContext,
  startMcpServer,
  writeTestConfig,
} from './fixtures.js';
import {
  callToolExpectSuccess,
  setupAdapterSymlink,
  startMockPreScriptServer,
  waitForExtensionConnected,
  waitForLog,
} from './helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PRESCRIPT_PLUGIN_DIR = path.join(ROOT, 'plugins/prescript-test');
const PLUGIN_NAME = 'prescript-test';
const REGISTRATION_ID = `opentabs-pre-${PLUGIN_NAME}`;

test.describe('Pre-script — document_start MAIN-world capture', () => {
  test('captures bearer token before the page overwrites window.fetch', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-prescript-'));
    let server: Awaited<ReturnType<typeof startMcpServer>> | undefined;
    let mock: Awaited<ReturnType<typeof startMockPreScriptServer>> | undefined;
    let context: Awaited<ReturnType<typeof launchExtensionContext>>['context'] | undefined;
    let cleanupDir: string | undefined;

    try {
      writeTestConfig(configDir, {
        localPlugins: [path.resolve(PRESCRIPT_PLUGIN_DIR)],
        permissions: {
          [PLUGIN_NAME]: { permission: 'auto' },
          browser: { permission: 'auto' },
        },
      });

      server = await startMcpServer(configDir, false);
      mock = await startMockPreScriptServer();

      const launched = await launchExtensionContext(server.port, server.secret);
      context = launched.context;
      cleanupDir = launched.cleanupDir;
      setupAdapterSymlink(configDir, launched.extensionDir);

      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped');

      // Wait for syncPreScripts to register the content script before navigating.
      // The mcp-server emits sync.full → extension registers the script → this
      // poll confirms the extension side has caught up before we navigate.
      const sw = context.serviceWorkers()[0];
      await expect
        .poll(
          async () => {
            const registered = (await sw?.evaluate(() => chrome.scripting.getRegisteredContentScripts())) as
              | Array<{ id: string }>
              | undefined;
            return registered?.some(r => r.id === REGISTRATION_ID) ?? false;
          },
          { timeout: 5_000 },
        )
        .toBe(true);

      // Assert registration shape: runAt=document_start, world=MAIN.
      const registered = (await sw?.evaluate(() => chrome.scripting.getRegisteredContentScripts())) as Array<{
        id: string;
        runAt: string;
        world: string;
      }>;
      const ours = registered.find(r => r.id === REGISTRATION_ID);
      expect(ours).toBeDefined();
      expect(ours?.runAt).toBe('document_start');
      expect(ours?.world).toBe('MAIN');

      // Open the mock page — the registered content script fires at document_start,
      // installs the fetch interceptor, then the page's inline script runs.
      const page = await context.newPage();
      await page.goto(mock.url, { waitUntil: 'load' });

      // Confirm the hostile page bootstrap ran: the page's inline script calls
      // fetch (pre-script intercepts it), then immediately overwrites window.fetch.
      // We wait for __pageBootstrapResult rather than networkidle — the mock page's
      // fetch stub rejects forever so networkidle never resolves.
      await page.waitForFunction(
        () => (window as unknown as { __pageBootstrapResult?: unknown }).__pageBootstrapResult !== undefined,
        { timeout: 5_000 },
      );
      const pageState = await page.evaluate(() => ({
        fetchOverrideInstalled: (window as unknown as { __fetchOverrideInstalled?: boolean }).__fetchOverrideInstalled,
        bootstrapResult: (window as unknown as { __pageBootstrapResult?: unknown }).__pageBootstrapResult,
      }));
      expect(pageState.fetchOverrideInstalled).toBe(true);
      expect(pageState.bootstrapResult).toMatchObject({ ok: true });

      // Pre-script stashed the bearer token into its plugin namespace.
      const captured = await page.evaluate(pluginName => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { preScript?: Record<string, Record<string, unknown>> }
          | undefined;
        return ot?.preScript?.[pluginName] ?? null;
      }, PLUGIN_NAME);
      expect((captured as Record<string, unknown> | null)?.authToken).toBe(mock.expectedToken);

      // Adapter can read the captured value via getPreScriptValue → echo_auth tool.
      const mcpClient = createMcpClient(server.port, server.secret);
      await mcpClient.initialize();
      try {
        const result = await callToolExpectSuccess(mcpClient, server, `${PLUGIN_NAME}_echo_auth`, {});
        expect(result).toMatchObject({ token: mock.expectedToken, source: 'pre-script' });
      } finally {
        await mcpClient.close();
      }
    } finally {
      await context?.close().catch(() => {});
      await mock?.kill();
      if (server) await server.kill();
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
