/**
 * Side panel — delete failed plugin E2E tests.
 *
 * Verifies that clicking the trash icon on a FailedPluginCard, confirming the
 * dialog, removes the plugin from config.json and the side panel UI.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createMinimalPlugin,
  expect,
  launchExtensionContext,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import { openSidePanel, setupAdapterSymlink, waitForExtensionConnected } from './helpers.js';

test.describe('Side panel — delete failed plugin', () => {
  test('deleting a failed local plugin removes the card and updates config', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-del-fail-'));
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-config-'));

    // Create a broken plugin (valid package.json with opentabs field, but no dist/)
    const brokenDir = path.join(tmpDir, 'broken-plugin');
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(
      path.join(brokenDir, 'package.json'),
      JSON.stringify({
        name: 'opentabs-plugin-broken-delete-test',
        version: '1.0.0',
        opentabs: { displayName: 'Broken Delete Test', description: 'A broken plugin for testing delete' },
      }),
    );
    const brokenPath = path.resolve(brokenDir);

    // Create a working plugin for reference (should survive the delete)
    const workingPath = createMinimalPlugin(tmpDir, 'test-survivor', [{ name: 'ping', description: 'A test tool' }]);

    writeTestConfig(configDir, {
      localPlugins: [workingPath, brokenPath],
      permissions: {
        'test-survivor': { permission: 'auto', reviewedVersion: '0.0.1' },
      },
    });

    const server = await startMcpServer(configDir, true);
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await mcpClient.initialize();

      const sidePanel = await openSidePanel(context);

      // Verify the failed plugin card is visible
      await expect(sidePanel.getByText('Failed to load')).toBeVisible({ timeout: 15_000 });

      // Verify the working plugin is also visible
      await expect(sidePanel.getByText('Test test-survivor')).toBeVisible({ timeout: 15_000 });

      // Click the trash icon on the failed plugin card
      const failedCard = sidePanel.locator('.border-destructive\\/50');
      await expect(failedCard).toBeVisible({ timeout: 5_000 });
      const trashButton = failedCard.locator('button').filter({ has: sidePanel.locator('svg') });
      await trashButton.click();

      // Confirmation dialog appears
      const dialog = sidePanel.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByText('Remove Plugin Path')).toBeVisible();
      await expect(
        dialog.getByText('Are you sure you want to remove this plugin path from your config?'),
      ).toBeVisible();

      // Click "Remove" to confirm
      await dialog.getByRole('button', { name: 'Remove' }).click();

      // Dialog closes
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });

      // Failed plugin card disappears
      await expect(sidePanel.getByText('Failed to load')).not.toBeVisible({ timeout: 15_000 });

      // Working plugin is still visible
      await expect(sidePanel.getByText('Test test-survivor')).toBeVisible();

      // Config.json no longer contains the broken plugin path
      await expect
        .poll(
          () => {
            const raw = fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8');
            const config = JSON.parse(raw) as { localPlugins?: string[] };
            return config.localPlugins;
          },
          {
            timeout: 10_000,
            message: 'config.json should no longer contain the broken plugin path',
          },
        )
        .not.toContain(brokenPath);

      // Config.json still contains the working plugin path
      const finalRaw = fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8');
      const finalConfig = JSON.parse(finalRaw) as { localPlugins?: string[] };
      expect(finalConfig.localPlugins).toContain(workingPath);
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});
