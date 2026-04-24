/**
 * POC: pre-script feature validation.
 *
 * This test proves the new pre-script mechanism solves the PR #69 (Outlook /
 * cloud.microsoft) problem. The mock server simulates the failure mode:
 *
 *   1. Page HTML has an INLINE <script> in <head> that:
 *      a. Fires fetch('/api/v2.0/me', { headers: { Authorization: 'Bearer <X>' } }).
 *      b. Immediately overwrites window.fetch with a stub.
 *
 *   2. An OpenTabs adapter injected after page load (via the normal
 *      chrome.scripting.executeScript path, which runs at document_idle)
 *      CANNOT observe the bearer token — the fetch already happened and the
 *      original window.fetch is gone.
 *
 *   3. A pre-script registered via chrome.scripting.registerContentScripts
 *      with runAt: 'document_start', world: 'MAIN' runs BEFORE the inline
 *      <script>. It captures the bearer header and stores it in
 *      globalThis.__openTabs.preScript[pluginName]. The adapter, injected
 *      later, reads it back via getPreScriptValue('authToken').
 *
 * This test tab is opened AFTER plugin registration (as a full navigation),
 * so the registered content script fires normally.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import type { McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  expect,
  launchExtensionContext,
  startMcpServer,
  symlinkCrossPlatform,
  test,
  writeTestConfig,
} from './fixtures.js';
import { callToolExpectSuccess, waitForExtensionConnected, waitForLog } from './helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const POC_PLUGIN_DIR = path.join(ROOT, 'plugins/prescript-test');
const MOCK_SERVER_ENTRY = path.join(ROOT, 'e2e/prescript-mock-server.ts');

/**
 * Spawn the mock Outlook server subprocess on an ephemeral port.
 * Mirrors startServerProcess in fixtures.ts but inlined here because the
 * fixture version is tied to the e2e-test server's specific control API.
 */
const startMockServer = (): Promise<{
  url: string;
  expectedToken: string;
  kill: () => Promise<void>;
}> =>
  new Promise((resolve, reject) => {
    const proc = spawn('node', ['--import', 'tsx/esm', MOCK_SERVER_ENTRY], {
      cwd: ROOT,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    const logs: string[] = [];
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      for (const line of text.split('\n')) if (line.trim()) logs.push(line);
      const portMatch = text.match(/Listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (portMatch && !resolved) {
        resolved = true;
        const port = Number(portMatch[1]);
        const url = `http://127.0.0.1:${String(port)}`;
        // Fetch the expected token from the server so the test knows what
        // to assert against.
        fetch(`${url}/control/server-info`)
          .then(r => r.json() as Promise<{ token: string }>)
          .then(data => {
            resolve({
              url,
              expectedToken: data.token,
              kill: async () => {
                proc.kill('SIGTERM');
                await new Promise<void>(r => setTimeout(r, 200));
                if (!proc.killed) proc.kill('SIGKILL');
              },
            });
          })
          .catch(reject);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', code => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`mock server exited with code ${String(code)}. Logs:\n${logs.join('\n')}`));
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGKILL');
        reject(new Error(`mock server did not start within 10s. Logs:\n${logs.join('\n')}`));
      }
    }, 10_000);
  });

test.describe('Pre-script POC', () => {
  test('pre-script captures bearer token before page overwrites window.fetch', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let mock: Awaited<ReturnType<typeof startMockServer>> | undefined;
    let context: BrowserContext | undefined;
    let cleanupDir: string | undefined;

    try {
      // 1. Isolated config dir with the POC plugin registered.
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-prescript-'));
      const extensionSubdir = path.join(configDir, 'extension');
      fs.mkdirSync(extensionSubdir, { recursive: true });
      const secret = crypto.randomUUID();
      fs.writeFileSync(path.join(extensionSubdir, 'auth.json'), `${JSON.stringify({ secret })}\n`, 'utf-8');

      writeTestConfig(configDir, {
        localPlugins: [path.resolve(POC_PLUGIN_DIR)],
        permissions: {
          'prescript-test': { permission: 'auto' },
          browser: { permission: 'auto' },
        },
      });

      // 2. Start MCP server.
      server = await startMcpServer(configDir, false);

      // 3. Start mock Outlook-style server.
      mock = await startMockServer();

      // 4. Launch extension-loaded Chromium and wire up the adapter symlink
      //    so the extension can resolve adapters/<file>.js paths.
      const launched = await launchExtensionContext(server.port, server.secret);
      context = launched.context;
      cleanupDir = launched.cleanupDir;

      const serverExtensionDir = path.join(server.configDir, 'extension');
      fs.mkdirSync(serverExtensionDir, { recursive: true });
      const serverAdaptersDir = path.join(serverExtensionDir, 'adapters');
      const extensionAdaptersDir = path.join(launched.extensionDir, 'adapters');
      fs.rmSync(serverAdaptersDir, { recursive: true, force: true });
      symlinkCrossPlatform(extensionAdaptersDir, serverAdaptersDir, 'dir');
      const serverAuthJson = path.join(serverExtensionDir, 'auth.json');
      const extensionAuthJson = path.join(launched.extensionDir, 'auth.json');
      fs.rmSync(extensionAuthJson, { force: true });
      symlinkCrossPlatform(serverAuthJson, extensionAuthJson, 'file');

      // 5. Wait for extension to connect and plugin to be synced.
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped');

      // 6. The extension's handleSyncFull calls syncPreScripts after storing
      //    plugin metadata — give it a moment to complete before navigating.
      await new Promise(r => setTimeout(r, 500));

      // 7. Open the mock app in a new tab — triggers the registered content
      //    script at document_start in MAIN world, before any page JS runs.
      const page = await context.newPage();
      await page.goto(mock.url, { waitUntil: 'load' });

      // 8. The mock page fires an authenticated fetch synchronously during
      //    head parsing, then overwrites window.fetch with a stub. Confirm
      //    both steps completed — this is the scenario the pre-script must
      //    beat.
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

      // 9. The registered content script should appear in Chrome's registry.
      const sw = context.serviceWorkers()[0];
      const registered = sw
        ? ((await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts())) as Array<{
            id: string;
            runAt: string;
            world: string;
          }>)
        : [];
      const ours = registered.find(r => r.id === 'opentabs-pre-prescript-test');
      expect(ours).toBeDefined();
      expect(ours?.runAt).toBe('document_start');
      expect(ours?.world).toBe('MAIN');

      // 10. The pre-script should have stashed the bearer into its namespace.
      const captured = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { preScript?: Record<string, Record<string, unknown>> }
          | undefined;
        return ot?.preScript?.['prescript-test'] ?? null;
      });
      expect(captured).not.toBeNull();
      expect((captured as Record<string, unknown>).authToken).toBe(mock.expectedToken);

      // 11. Wait for the adapter to be injected (document_idle).
      await page.waitForFunction(
        () => {
          const ot = (globalThis as Record<string, unknown>).__openTabs as
            | { adapters?: Record<string, unknown> }
            | undefined;
          return ot?.adapters?.['prescript-test'] !== undefined;
        },
        { timeout: 20_000 },
      );

      // 12. Call the echo_auth tool — the adapter's getPreScriptValue
      //     should return the same token the pre-script captured.
      const mcpClient = createMcpClient(server.port, server.secret);
      await mcpClient.initialize();
      try {
        const result = await callToolExpectSuccess(mcpClient, server, 'prescript-test_echo_auth', {});
        expect(result).toMatchObject({
          token: mock.expectedToken,
          source: 'pre-script',
        });
      } finally {
        await mcpClient.close();
      }
    } finally {
      await context?.close().catch(() => {});
      await mock?.kill();
      await server?.kill();
      if (cleanupDir) {
        try {
          fs.rmSync(cleanupDir, { recursive: true, force: true });
        } catch {
          // best-effort
        }
      }
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});
