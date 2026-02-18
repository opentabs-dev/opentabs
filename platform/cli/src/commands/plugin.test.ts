import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const CLI_PATH = resolve(import.meta.dirname, '..', '..', 'dist', 'cli.js');

/** Spawn the opentabs CLI binary synchronously with an isolated config dir. */
const runCli = (
  args: string[],
  opts: { cwd: string; configDir: string },
): { exitCode: number; stdout: string; stderr: string } => {
  const result = Bun.spawnSync(['bun', CLI_PATH, ...args], {
    cwd: opts.cwd,
    env: { ...Bun.env, OPENTABS_CONFIG_DIR: opts.configDir },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

/** Read the config.json from the isolated config dir. */
const readTestConfig = async (configDir: string): Promise<Record<string, unknown>> => {
  const configPath = join(configDir, 'config.json');
  return (await Bun.file(configPath).json()) as Record<string, unknown>;
};

/** Create a minimal plugin directory with an opentabs-plugin.json manifest. */
const createMinimalPlugin = async (
  dir: string,
  manifest: { name: string; version: string; tools: Array<{ name: string }> },
): Promise<void> => {
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, 'opentabs-plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
};

describe('opentabs plugin commands', () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-plugin-cmd-test-'));
    configDir = join(tmpDir, '.opentabs');
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // plugin add
  // -------------------------------------------------------------------------

  describe('plugin add', () => {
    test('adds a plugin path to config.json', async () => {
      const pluginDir = join(tmpDir, 'my-plugin');
      mkdirSync(pluginDir);

      const { exitCode, stdout } = runCli(['plugin', 'add', pluginDir], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Added:');

      const config = await readTestConfig(configDir);
      const plugins = config.plugins as string[];
      expect(Array.isArray(plugins)).toBe(true);

      // The path should be stored relative to the config dir
      const expectedRelative = relative(configDir, pluginDir);
      expect(plugins).toContain(expectedRelative);
    });

    test('creates config.json if it does not exist', async () => {
      const pluginDir = join(tmpDir, 'new-plugin');
      mkdirSync(pluginDir);

      // Remove the config dir so add creates it fresh
      rmSync(configDir, { recursive: true, force: true });

      const { exitCode } = runCli(['plugin', 'add', pluginDir], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(existsSync(join(configDir, 'config.json'))).toBe(true);

      const config = await readTestConfig(configDir);
      expect(Array.isArray(config.plugins)).toBe(true);
      expect(typeof config.secret).toBe('string');
    });

    test('detects duplicate plugin path and prints "already configured"', async () => {
      const pluginDir = join(tmpDir, 'dup-plugin');
      mkdirSync(pluginDir);

      // Add the plugin once
      runCli(['plugin', 'add', pluginDir], { cwd: tmpDir, configDir });

      // Add the same plugin again
      const { exitCode, stdout } = runCli(['plugin', 'add', pluginDir], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('already configured');

      // Verify only one entry in config
      const config = await readTestConfig(configDir);
      const plugins = config.plugins as string[];
      const expectedRelative = relative(configDir, pluginDir);
      const matchingEntries = plugins.filter(p => p === expectedRelative);
      expect(matchingEntries).toHaveLength(1);
    });

    test('warns when path does not exist but still adds it', async () => {
      const nonexistentPath = join(tmpDir, 'does-not-exist');

      const { exitCode, stderr } = runCli(['plugin', 'add', nonexistentPath], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toContain('Warning');

      const config = await readTestConfig(configDir);
      const plugins = config.plugins as string[];
      expect(plugins.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // plugin list
  // -------------------------------------------------------------------------

  describe('plugin list', () => {
    test('prints message when no plugins are configured', async () => {
      // Create an empty config
      await Bun.write(
        join(configDir, 'config.json'),
        JSON.stringify({ plugins: [], tools: {}, secret: 'test' }) + '\n',
      );

      const { exitCode, stdout } = runCli(['plugin', 'list'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('No plugins configured');
    });

    test('--json outputs JSON array with plugin info', async () => {
      const pluginDir = join(tmpDir, 'json-test-plugin');
      await createMinimalPlugin(pluginDir, {
        name: 'json-test',
        version: '1.0.0',
        tools: [{ name: 'test_tool' }],
      });

      // Add the plugin to config
      runCli(['plugin', 'add', pluginDir], { cwd: tmpDir, configDir });

      const { exitCode, stdout } = runCli(['plugin', 'list', '--json'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);

      const entries = JSON.parse(stdout) as Array<{
        path: string;
        resolvedPath: string;
        exists: boolean;
        hasManifest: boolean;
        name: string;
        version: string;
        toolCount: number;
      }>;

      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBe(1);

      const entry = entries[0];
      expect(entry).toBeDefined();
      expect(entry?.exists).toBe(true);
      expect(entry?.hasManifest).toBe(true);
      expect(entry?.name).toBe('json-test');
      expect(entry?.version).toBe('1.0.0');
      expect(entry?.toolCount).toBe(1);
      expect(entry?.resolvedPath).toBe(pluginDir);
    });

    test('exits with code 1 when config does not exist', () => {
      // Remove config dir entirely
      rmSync(configDir, { recursive: true, force: true });
      mkdirSync(configDir, { recursive: true });

      const { exitCode, stderr } = runCli(['plugin', 'list'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('No config found');
    });
  });

  // -------------------------------------------------------------------------
  // plugin remove
  // -------------------------------------------------------------------------

  describe('plugin remove', () => {
    test('removes a plugin path from config.json', async () => {
      const pluginDir = join(tmpDir, 'remove-me');
      mkdirSync(pluginDir);

      // Add the plugin first
      runCli(['plugin', 'add', pluginDir], { cwd: tmpDir, configDir });

      // Verify it was added
      const configBefore = await readTestConfig(configDir);
      expect((configBefore.plugins as string[]).length).toBe(1);

      // Remove it using the relative path stored in config
      const storedPath = (configBefore.plugins as string[])[0] as string;
      const { exitCode, stdout } = runCli(['plugin', 'remove', storedPath], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Removed:');

      // Verify it was removed
      const configAfter = await readTestConfig(configDir);
      expect((configAfter.plugins as string[]).length).toBe(0);
    });

    test('removes a plugin by directory name', async () => {
      const pluginDir = join(tmpDir, 'my-named-plugin');
      mkdirSync(pluginDir);

      // Add the plugin
      runCli(['plugin', 'add', pluginDir], { cwd: tmpDir, configDir });

      // Remove by just the directory name
      const { exitCode, stdout } = runCli(['plugin', 'remove', 'my-named-plugin'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Removed:');

      const config = await readTestConfig(configDir);
      expect((config.plugins as string[]).length).toBe(0);
    });

    test('exits with code 1 when plugin is not found in config', () => {
      // Create config with one plugin
      const pluginDir = join(tmpDir, 'existing-plugin');
      mkdirSync(pluginDir);
      runCli(['plugin', 'add', pluginDir], { cwd: tmpDir, configDir });

      // Try to remove a non-existent plugin
      const { exitCode, stderr } = runCli(['plugin', 'remove', 'nonexistent-plugin'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Plugin not found');
    });

    test('exits with code 1 when config does not exist', () => {
      // Remove config dir entirely and recreate empty
      rmSync(configDir, { recursive: true, force: true });
      mkdirSync(configDir, { recursive: true });

      const { exitCode, stderr } = runCli(['plugin', 'remove', 'anything'], {
        cwd: tmpDir,
        configDir,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('No config found');
    });
  });
});
