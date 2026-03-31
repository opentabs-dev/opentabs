/**
 * Eager adapter file writes — E2E tests verifying that adapter IIFE files
 * are written to disk during server startup and reload, independently of
 * extension connection state.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  cleanupTestConfigDir,
  createTestConfigDir,
  expect,
  readTestConfig,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  callToolExpectSuccess,
  setupToolTest,
  unwrapSingleConnection,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

test.describe('Eager adapter file writes', () => {
  test('adapter files exist on disk before extension connects', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      // Verify server is healthy
      const health = await server.health();
      expect(health).not.toBeNull();
      if (!health) throw new Error('health returned null');
      expect(health.status).toBe('ok');

      // List files in the adapters directory — adapter files should already
      // exist because reloadCore writes them eagerly during startup.
      const adaptersDir = path.join(configDir, 'extension', 'adapters');
      const files = fs.readdirSync(adaptersDir);

      // The e2e-test plugin adapter should be present with a content-hashed filename
      const adapterFiles = files.filter(f => f.startsWith('e2e-test-') && f.endsWith('.js'));
      expect(adapterFiles.length).toBe(1);

      // Verify the file is non-empty
      const adapterPath = path.join(adaptersDir, adapterFiles[0] as string);
      const stat = fs.statSync(adapterPath);
      expect(stat.size).toBeGreaterThan(0);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('adapter files are re-written after hot reload without extension', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const adaptersDir = path.join(configDir, 'extension', 'adapters');

      // Verify adapter files exist after startup
      const filesBefore = fs.readdirSync(adaptersDir);
      const adaptersBefore = filesBefore.filter(f => f.startsWith('e2e-test-') && f.endsWith('.js'));
      expect(adaptersBefore.length).toBe(1);

      // Delete all adapter files
      for (const file of filesBefore) {
        fs.unlinkSync(path.join(adaptersDir, file));
      }
      expect(fs.readdirSync(adaptersDir).length).toBe(0);

      // Trigger hot reload and wait for it to complete
      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 20_000);

      // Verify adapter files are re-created
      const filesAfter = fs.readdirSync(adaptersDir);
      const adaptersAfter = filesAfter.filter(f => f.startsWith('e2e-test-') && f.endsWith('.js'));
      expect(adaptersAfter.length).toBe(1);

      // Verify the re-created file is non-empty
      const adapterPath = path.join(adaptersDir, adaptersAfter[0] as string);
      const stat = fs.statSync(adapterPath);
      expect(stat.size).toBeGreaterThan(0);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Adapter file cleanup on plugin removal', () => {
  test('removing plugin clears adapter files, re-adding recreates them', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const adaptersDir = path.join(configDir, 'extension', 'adapters');

      // Step 1: Verify adapter files exist after startup
      const filesInitial = fs.readdirSync(adaptersDir);
      const adaptersInitial = filesInitial.filter(f => f.startsWith('e2e-test-') && f.endsWith('.js'));
      expect(adaptersInitial.length).toBe(1);

      // Step 2: Remove the plugin from config and trigger hot reload
      const config = readTestConfig(configDir);
      const originalLocalPlugins = [...config.localPlugins];
      const originalPermissions = config.permissions ? { ...config.permissions } : undefined;

      writeTestConfig(configDir, {
        ...config,
        localPlugins: [],
        permissions: { browser: { permission: 'auto' } },
      });

      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 20_000);

      // Verify 0 adapter files for e2e-test exist after removal
      const filesAfterRemoval = fs.readdirSync(adaptersDir);
      const adaptersAfterRemoval = filesAfterRemoval.filter(f => f.startsWith('e2e-test-') && f.endsWith('.js'));
      expect(adaptersAfterRemoval.length).toBe(0);

      // Step 3: Re-add the plugin and trigger hot reload
      writeTestConfig(configDir, {
        ...config,
        localPlugins: originalLocalPlugins,
        permissions: originalPermissions,
      });

      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 20_000);

      // Verify exactly 1 adapter file exists after re-adding
      const filesAfterReAdd = fs.readdirSync(adaptersDir);
      const adaptersAfterReAdd = filesAfterReAdd.filter(f => f.startsWith('e2e-test-') && f.endsWith('.js'));
      expect(adaptersAfterReAdd.length).toBe(1);

      // Verify the re-created file is non-empty and contains valid IIFE structure
      const adapterPath = path.join(adaptersDir, adaptersAfterReAdd[0] as string);
      const content = fs.readFileSync(adapterPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      expect(content.startsWith('(') || content.startsWith('void') || content.startsWith('"use strict"')).toBe(true);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Eager adapter injection on first connect', () => {
  test('extension injects adapters and reaches ready state on first connection', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify tool dispatch succeeds — proves the adapter was injected and the
    // plugin reached ready state on the first connection attempt.
    const result = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'eager-adapters' },
      { isError: false },
      15_000,
    );
    expect(result.content).toContain('eager-adapters');

    // Verify via extension_check_adapter that the adapter is present, hash
    // matches, and the plugin is ready — confirming no re-injection was needed.
    const checkRaw = await callToolExpectSuccess(mcpClient, mcpServer, 'extension_check_adapter', {
      plugin: 'e2e-test',
    });
    const checkResult = unwrapSingleConnection(checkRaw);

    expect(checkResult.plugin).toBe('e2e-test');

    const tabs = checkResult.matchingTabs as Array<{
      adapterPresent: boolean;
      hashMatch: boolean;
      isReady: boolean;
    }>;
    expect(tabs.length).toBeGreaterThanOrEqual(1);

    const tab = tabs[0];
    if (!tab) throw new Error('Expected at least one matching tab');
    expect(tab.adapterPresent).toBe(true);
    expect(tab.hashMatch).toBe(true);
    expect(tab.isReady).toBe(true);
  });
});
