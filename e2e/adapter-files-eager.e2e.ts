/**
 * Eager adapter file writes — E2E tests verifying that adapter IIFE files
 * are written to disk during server startup and reload, independently of
 * extension connection state.
 */

import fs from 'node:fs';
import path from 'node:path';
import { cleanupTestConfigDir, createTestConfigDir, expect, startMcpServer, test } from './fixtures.js';
import { waitForLog } from './helpers.js';

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
