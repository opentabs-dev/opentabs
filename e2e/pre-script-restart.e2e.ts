/**
 * Pre-script restart E2E test — regression test for the onStartup re-sync path
 * (US-007). Verifies that opentabs-pre-prescript-test is re-registered after
 * the extension restarts, proving that syncPreScripts fires on startup.
 *
 * In Playwright's headless Chromium, chrome.runtime.reload() terminates the
 * extension service worker but Chromium does not restart it automatically.
 * The test simulates the full restart cycle: trigger chrome.runtime.reload()
 * to confirm the disconnect path, then close the dead context and launch a
 * fresh extension context — which runs the same top-level startup code as
 * onInstalled/onStartup and re-registers pre-scripts from the MCP sync.full.
 *
 * Uses the plain Playwright `test` (not fixture-based) to manage bespoke
 * mock server infrastructure alongside two sequential extension contexts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupTestConfigDir,
  launchExtensionContext,
  startMcpServer,
  symlinkCrossPlatform,
  writeTestConfig,
} from './fixtures.js';
import {
  setupAdapterSymlink,
  startMockPreScriptServer,
  waitForExtensionConnected,
  waitForExtensionDisconnected,
  waitForLog,
} from './helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PRESCRIPT_PLUGIN_DIR = path.join(ROOT, 'plugins/prescript-test');
const PLUGIN_NAME = 'prescript-test';
const REGISTRATION_ID = `opentabs-pre-${PLUGIN_NAME}`;

test.describe('Pre-script — registration survives extension restart', () => {
  test('pre-script re-registers after extension restart via onStartup sync path', async () => {
    test.slow();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-prescript-restart-'));
    let server: Awaited<ReturnType<typeof startMcpServer>> | undefined;
    let mock: Awaited<ReturnType<typeof startMockPreScriptServer>> | undefined;
    let context: Awaited<ReturnType<typeof launchExtensionContext>>['context'] | undefined;
    let cleanupDir: string | undefined;
    let context2: Awaited<ReturnType<typeof launchExtensionContext>>['context'] | undefined;
    let cleanupDir2: string | undefined;

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

      // Wait for pre-script to be registered in the initial extension context.
      const sw = context.serviceWorkers()[0];
      await expect
        .poll(
          async () => {
            const registered = (await sw?.evaluate(() => chrome.scripting.getRegisteredContentScripts())) as
              | Array<{ id: string }>
              | undefined;
            return registered?.some(r => r.id === REGISTRATION_ID) ?? false;
          },
          { timeout: 10_000 },
        )
        .toBe(true);

      // Baseline: confirm the registration shape before restart.
      const registeredBefore = (await sw?.evaluate(() => chrome.scripting.getRegisteredContentScripts())) as Array<{
        id: string;
        runAt: string;
        world: string;
      }>;
      const oursBefore = registeredBefore.find(r => r.id === REGISTRATION_ID);
      expect(oursBefore).toBeDefined();
      expect(oursBefore?.runAt).toBe('document_start');
      expect(oursBefore?.world).toBe('MAIN');

      // Baseline: confirm token capture works before restart.
      const page = await context.newPage();
      await page.goto(mock.url, { waitUntil: 'load' });
      await page.waitForFunction(
        () => (window as unknown as { __pageBootstrapResult?: unknown }).__pageBootstrapResult !== undefined,
        { timeout: 5_000 },
      );
      const captured = await page.evaluate(pluginName => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { preScript?: Record<string, Record<string, unknown>> }
          | undefined;
        return ot?.preScript?.[pluginName] ?? null;
      }, PLUGIN_NAME);
      expect((captured as Record<string, unknown> | null)?.authToken).toBe(mock.expectedToken);

      // Trigger extension reload from the service worker — this terminates the
      // service worker and disconnects from the MCP server. In Playwright's
      // headless Chromium, chrome.runtime.reload() terminates the extension but
      // Chromium does not restart it automatically. We close the dead context
      // and launch a fresh one to simulate the restart cycle, which exercises
      // the same top-level initialization code (syncPreScripts) that onStartup
      // invokes in a real browser.
      server.logs.length = 0;
      await sw?.evaluate(() => {
        chrome.runtime.reload();
      });

      await waitForExtensionDisconnected(server, 15_000);

      // Close the dead context — the extension service worker is gone.
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      context = undefined;

      // Launch a fresh extension context pointed at the same MCP server.
      // This runs the extension's top-level startup code (which includes
      // syncPreScripts) and fires chrome.runtime.onInstalled, reproducing
      // the same re-registration path as a real browser onStartup event.
      const launched2 = await launchExtensionContext(server.port, server.secret);
      context2 = launched2.context;
      cleanupDir2 = launched2.cleanupDir;

      // Repoint the adapter symlink to the new extension copy.
      const serverAdaptersParent = path.join(configDir, 'extension');
      fs.mkdirSync(serverAdaptersParent, { recursive: true });
      const serverAdaptersDir = path.join(serverAdaptersParent, 'adapters');
      const extensionAdaptersDir = path.join(launched2.extensionDir, 'adapters');
      fs.rmSync(serverAdaptersDir, { recursive: true, force: true });
      symlinkCrossPlatform(extensionAdaptersDir, serverAdaptersDir, 'dir');

      server.logs.length = 0;

      // Wait for the fresh extension to connect and for sync.full to deliver
      // plugin metadata — this is the path that re-registers the pre-script.
      await waitForExtensionConnected(server, 45_000);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // Re-assert the pre-script registration is back after restart.
      const sw2 = context2.serviceWorkers()[0];
      await expect
        .poll(
          async () => {
            const registered = (await sw2?.evaluate(() => chrome.scripting.getRegisteredContentScripts())) as
              | Array<{ id: string }>
              | undefined;
            return registered?.some(r => r.id === REGISTRATION_ID) ?? false;
          },
          { timeout: 15_000 },
        )
        .toBe(true);

      const registeredAfter = (await sw2?.evaluate(() => chrome.scripting.getRegisteredContentScripts())) as Array<{
        id: string;
        runAt: string;
        world: string;
      }>;
      const oursAfter = registeredAfter.find(r => r.id === REGISTRATION_ID);
      expect(oursAfter).toBeDefined();
      expect(oursAfter?.runAt).toBe('document_start');
      expect(oursAfter?.world).toBe('MAIN');

      // End-to-end: navigate to the mock URL in the fresh context and confirm
      // the bearer token is still captured by the re-registered pre-script.
      const page2 = await context2.newPage();
      await page2.goto(mock.url, { waitUntil: 'load' });
      await page2.waitForFunction(
        () => (window as unknown as { __pageBootstrapResult?: unknown }).__pageBootstrapResult !== undefined,
        { timeout: 5_000 },
      );
      const captured2 = await page2.evaluate(pluginName => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { preScript?: Record<string, Record<string, unknown>> }
          | undefined;
        return ot?.preScript?.[pluginName] ?? null;
      }, PLUGIN_NAME);
      expect((captured2 as Record<string, unknown> | null)?.authToken).toBe(mock.expectedToken);
    } finally {
      await context2?.close().catch(() => {});
      await context?.close().catch(() => {});
      await mock?.kill();
      if (server) await server.kill();
      if (cleanupDir2) fs.rmSync(cleanupDir2, { recursive: true, force: true });
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
