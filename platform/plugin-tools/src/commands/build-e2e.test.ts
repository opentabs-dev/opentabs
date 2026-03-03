import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_PATH = resolve(import.meta.dirname, '..', '..', 'dist', 'cli.js');
const E2E_PLUGIN_DIR = resolve(import.meta.dirname, '..', '..', '..', '..', 'plugins', 'e2e-test');

/**
 * Run `opentabs-plugin build` in the given plugin directory.
 * Uses an isolated config directory so the build doesn't register
 * in the user's real ~/.opentabs/config.json or notify a running server.
 */
const runBuild = (pluginDir: string, configDir: string): { exitCode: number; stdout: string; stderr: string } => {
  const result = spawnSync('node', [CLI_PATH, 'build'], {
    cwd: pluginDir,
    env: { ...process.env, OPENTABS_CONFIG_DIR: configDir },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

/**
 * Copy the e2e-test plugin to a temp directory. Excludes node_modules from the
 * deep copy and creates a symlink to the original node_modules instead, so the
 * dynamic import in `opentabs-plugin build` can resolve `@opentabs-dev/plugin-sdk`.
 */
const copyPlugin = (destDir: string): void => {
  cpSync(E2E_PLUGIN_DIR, destDir, {
    recursive: true,
    filter: (src: string) => !src.includes('node_modules'),
  });
  symlinkSync(
    join(E2E_PLUGIN_DIR, 'node_modules'),
    join(destDir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
};

/** Check if a file exists using node:fs/promises access */
const fileExists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

describe('opentabs-plugin build E2E', () => {
  // Tracks why the suite is being skipped (null means the plugin is available and tests run normally).
  // Set in beforeAll if the e2e-test plugin cannot be installed or built.
  let e2eSkipReason: string | null = null;

  // Ensure the e2e-test plugin has its dependencies installed and is compiled.
  // The test symlinks node_modules from the source dir into temp copies,
  // so the source must have node_modules populated and dist/ built.
  // In CI or fresh clones (e.g. the consolidator) these may be missing.
  beforeAll(() => {
    if (!existsSync(join(E2E_PLUGIN_DIR, 'package.json'))) {
      e2eSkipReason = 'e2e-test plugin not available (run: cd plugins/e2e-test && npm install && npm run build)';
      return;
    }
    if (!existsSync(join(E2E_PLUGIN_DIR, 'node_modules', '@opentabs-dev', 'plugin-sdk'))) {
      const result = spawnSync('npm', ['install'], { cwd: E2E_PLUGIN_DIR, stdio: 'pipe' });
      if (result.status !== 0) {
        e2eSkipReason = 'e2e-test plugin not available (run: cd plugins/e2e-test && npm install && npm run build)';
        return;
      }
    }
    if (!existsSync(join(E2E_PLUGIN_DIR, 'dist', 'index.js'))) {
      const result = spawnSync('npm', ['run', 'build'], {
        cwd: E2E_PLUGIN_DIR,
        stdio: 'pipe',
        env: { ...process.env, OPENTABS_CONFIG_DIR: join(E2E_PLUGIN_DIR, '.opentabs-test-config') },
      });
      if (result.status !== 0) {
        e2eSkipReason = 'e2e-test plugin not available (run: cd plugins/e2e-test && npm install && npm run build)';
        return;
      }
    }
  }, 120_000);

  let tmpDir = '';
  let configDir = '';

  beforeEach(ctx => {
    if (e2eSkipReason !== null) {
      ctx.skip();
      return;
    }
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-build-e2e-'));
    configDir = join(tmpDir, '.opentabs');
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Successful build
  // ---------------------------------------------------------------------------

  describe('successful build', () => {
    test('builds e2e-test plugin and generates manifest + IIFE', async () => {
      const pluginDir = join(tmpDir, 'e2e-test');
      copyPlugin(pluginDir);

      // Remove generated artifacts to ensure build creates them fresh
      rmSync(join(pluginDir, 'dist', 'tools.json'), { force: true });
      rmSync(join(pluginDir, 'dist', 'adapter.iife.js'), { force: true });

      const { exitCode, stdout, stderr } = runBuild(pluginDir, configDir);

      // stderr may contain the isReady() warning when the plugin is built outside a browser
      if (stderr.length > 0) {
        expect(stderr).toContain('isReady()');
      }
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Built ');

      // Verify dist/tools.json was generated
      const toolsJsonPath = join(pluginDir, 'dist', 'tools.json');
      expect(await fileExists(toolsJsonPath)).toBe(true);

      const manifest = JSON.parse(await readFile(toolsJsonPath, 'utf-8')) as {
        sdkVersion: string;
        tools: Array<{
          name: string;
          displayName: string;
          description: string;
          icon: string;
          input_schema: Record<string, unknown>;
          output_schema: Record<string, unknown>;
        }>;
      };

      // Verify manifest has top-level structure
      expect(typeof manifest.sdkVersion).toBe('string');
      expect(manifest.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
      expect(Array.isArray(manifest.tools)).toBe(true);

      // Verify tools array has expected structure
      expect(manifest.tools.length).toBeGreaterThanOrEqual(1);
      for (const tool of manifest.tools) {
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.displayName).toBe('string');
        expect(tool.displayName.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.icon).toBe('string');
        expect(tool.icon.length).toBeGreaterThan(0);
        expect(tool.input_schema).toBeDefined();
        expect(typeof tool.input_schema).toBe('object');
        expect(tool.output_schema).toBeDefined();
        expect(typeof tool.output_schema).toBe('object');
      }
    });

    test('generates adapter.iife.js with IIFE wrapper', async () => {
      const pluginDir = join(tmpDir, 'e2e-test');
      copyPlugin(pluginDir);

      rmSync(join(pluginDir, 'dist', 'adapter.iife.js'), { force: true });

      const { exitCode } = runBuild(pluginDir, configDir);
      expect(exitCode).toBe(0);

      const iifePath = join(pluginDir, 'dist', 'adapter.iife.js');
      expect(await fileExists(iifePath)).toBe(true);

      const iifeContent = await readFile(iifePath, 'utf-8');
      expect(iifeContent.length).toBeGreaterThan(0);

      // IIFE should contain the self-invoking wrapper pattern
      expect(iifeContent).toContain('(() => {');
    });

    test('adapter.iife.js contains __adapterHash assignment', async () => {
      const pluginDir = join(tmpDir, 'e2e-test');
      copyPlugin(pluginDir);

      rmSync(join(pluginDir, 'dist', 'adapter.iife.js'), { force: true });

      const { exitCode } = runBuild(pluginDir, configDir);
      expect(exitCode).toBe(0);

      const iifeContent = await readFile(join(pluginDir, 'dist', 'adapter.iife.js'), 'utf-8');
      expect(iifeContent).toContain('__adapterHash');
    });

    test('adapter.iife.js contains Object.freeze call', async () => {
      const pluginDir = join(tmpDir, 'e2e-test');
      copyPlugin(pluginDir);

      rmSync(join(pluginDir, 'dist', 'adapter.iife.js'), { force: true });

      const { exitCode } = runBuild(pluginDir, configDir);
      expect(exitCode).toBe(0);

      const iifeContent = await readFile(join(pluginDir, 'dist', 'adapter.iife.js'), 'utf-8');
      expect(iifeContent).toContain('Object.freeze');
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-tsc when dist/index.js is missing
  // ---------------------------------------------------------------------------

  describe('auto-tsc', () => {
    test('automatically runs tsc when dist/index.js is missing but src/index.ts exists', async () => {
      const pluginDir = join(tmpDir, 'auto-tsc');
      copyPlugin(pluginDir);

      // Remove compiled output so auto-tsc kicks in
      rmSync(join(pluginDir, 'dist', 'index.js'), { force: true });

      const { exitCode, stdout } = runBuild(pluginDir, configDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Compiled output not found, running tsc...');
      expect(stdout).toContain('Built ');

      // Verify dist/index.js was recreated by tsc
      expect(await fileExists(join(pluginDir, 'dist', 'index.js'))).toBe(true);
    }, 30_000);

    test('fails with descriptive error when neither dist/index.js nor src/index.ts exists', () => {
      const pluginDir = join(tmpDir, 'no-source');
      copyPlugin(pluginDir);

      // Remove both compiled output and source
      rmSync(join(pluginDir, 'dist', 'index.js'), { force: true });
      rmSync(join(pluginDir, 'src', 'index.ts'), { force: true });

      const { exitCode, stderr } = runBuild(pluginDir, configDir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Neither compiled output');
      expect(stderr).toContain('nor source');
    });

    test('does not run tsc when dist/index.js already exists', () => {
      const pluginDir = join(tmpDir, 'existing-dist');
      copyPlugin(pluginDir);

      // dist/index.js exists from the copy — build should succeed without auto-tsc message
      const { exitCode, stdout } = runBuild(pluginDir, configDir);

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain('Compiled output not found, running tsc...');
      expect(stdout).toContain('Built ');
    });
  });

  // ---------------------------------------------------------------------------
  // Validation errors
  // ---------------------------------------------------------------------------

  describe('validation errors', () => {
    test('exits with code 1 when plugin has an invalid name', async () => {
      const pluginDir = join(tmpDir, 'invalid-name');
      copyPlugin(pluginDir);

      // Modify the compiled dist/index.js to change the plugin name to 'INVALID'
      const distIndex = join(pluginDir, 'dist', 'index.js');
      const content = await readFile(distIndex, 'utf-8');
      const modified = content.replace(/name\s*=\s*["']e2e-test["']/, 'name = "INVALID"');
      await writeFile(distIndex, modified, 'utf-8');

      const { exitCode, stderr } = runBuild(pluginDir, configDir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Validation failed');
    });

    test('exits with code 1 when plugin has no tools', async () => {
      const pluginDir = join(tmpDir, 'no-tools');
      copyPlugin(pluginDir);

      // Modify the compiled dist/index.js to set tools to an empty array.
      // The compiled output uses class field syntax: `tools = [\n  echo, greet, ...];`
      const distIndex = join(pluginDir, 'dist', 'index.js');
      const content = await readFile(distIndex, 'utf-8');
      const modified = content.replace(/tools\s*=\s*\[\s*echo[\s\S]*?\];/, 'tools = [];');
      await writeFile(distIndex, modified, 'utf-8');

      const { exitCode, stderr } = runBuild(pluginDir, configDir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Validation failed');
    });
  });
});
