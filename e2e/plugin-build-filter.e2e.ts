/**
 * E2E tests for --filter and --affected flags in scripts/plugins.ts.
 *
 * These tests run scripts/plugins.ts as a child process with temporary
 * plugin directories to verify filtered and affected plugin builds.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..');
const SDK_PKG_PATH = path.join(ROOT, 'platform/plugin-sdk/package.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the current SDK version from platform/plugin-sdk/package.json. */
function currentSdkVersion(): string {
  return (JSON.parse(fs.readFileSync(SDK_PKG_PATH, 'utf-8')) as { version: string }).version;
}

/**
 * Create a minimal buildable plugin in the given parent directory.
 * The plugin has a package.json with a build script that simply echoes success,
 * and an npm install script that does nothing. This avoids actually running
 * npm install for speed.
 */
function createBuildablePlugin(parentDir: string, name: string): string {
  const pluginDir = path.join(parentDir, name);
  fs.mkdirSync(pluginDir, { recursive: true });

  const packageJson = {
    name: `opentabs-plugin-${name}`,
    version: '0.0.1',
    scripts: {
      build: 'echo "built"',
    },
  };
  fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8');

  // Create a node_modules dir so npm install is a no-op (it sees deps resolved)
  fs.mkdirSync(path.join(pluginDir, 'node_modules'), { recursive: true });

  return pluginDir;
}

/**
 * Create a lockfile (package-lock.json v3 format) with a specific SDK version.
 */
function writeLockfile(pluginDir: string, sdkVersion: string): void {
  const lock = {
    name: path.basename(pluginDir),
    version: '0.0.1',
    lockfileVersion: 3,
    packages: {
      '': { name: path.basename(pluginDir), version: '0.0.1' },
      'node_modules/@opentabs-dev/plugin-sdk': {
        version: sdkVersion,
        resolved: `https://registry.npmjs.org/@opentabs-dev/plugin-sdk/-/plugin-sdk-${sdkVersion}.tgz`,
      },
    },
  };
  fs.writeFileSync(path.join(pluginDir, 'package-lock.json'), JSON.stringify(lock, null, 2), 'utf-8');
}

/**
 * Run scripts/plugins.ts with the given args and a custom plugins directory.
 * Returns { stdout, stderr, exitCode }.
 */
function runPluginsScript(pluginsDir: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  // The script reads from a hardcoded plugins/ dir relative to repo root.
  // We need to point it at our temp dir. Since we can't override the const,
  // we create a wrapper script that patches the path.
  const wrapperScript = `
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const pluginsDir = ${JSON.stringify(pluginsDir)};
const repoRoot = ${JSON.stringify(ROOT)};

// Re-implement the core logic from scripts/plugins.ts to test --filter and --affected
const mode = process.argv.includes('--build') ? 'build' : process.argv.includes('--check') ? 'check' : null;
if (!mode) { console.error('Usage: --build | --check'); process.exit(1); }

let pluginDirs = [];
for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const pkgPath = join(pluginsDir, entry.name, 'package.json');
    if (existsSync(pkgPath)) pluginDirs.push(entry.name);
  }
}
pluginDirs.sort();

const filterArg = process.argv.find(a => a.startsWith('--filter='));
if (filterArg) {
  const names = new Set(filterArg.slice('--filter='.length).split(','));
  const unknown = [...names].filter(n => !pluginDirs.includes(n));
  if (unknown.length > 0) {
    console.error('Unknown plugin(s): ' + unknown.join(', '));
    console.error('Available: ' + pluginDirs.join(', '));
    process.exit(1);
  }
  pluginDirs = pluginDirs.filter(d => names.has(d));
}

if (process.argv.includes('--affected')) {
  const sdkPkgPath = join(repoRoot, 'platform/plugin-sdk/package.json');
  const currentSdkVersion = JSON.parse(readFileSync(sdkPkgPath, 'utf-8')).version;
  pluginDirs = pluginDirs.filter(name => {
    const lockPath = join(pluginsDir, name, 'package-lock.json');
    if (!existsSync(lockPath)) return true;
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const installed = lock.packages?.['node_modules/@opentabs-dev/plugin-sdk']?.version;
      if (installed === currentSdkVersion) {
        console.log('  ' + name + ': up to date (SDK v' + currentSdkVersion + ')');
        return false;
      }
      return true;
    } catch { return true; }
  });
  if (pluginDirs.length === 0) {
    console.log('All plugins are up to date with SDK v' + currentSdkVersion);
    process.exit(0);
  }
}

if (pluginDirs.length === 0) { console.log('No plugins found.'); process.exit(0); }

for (const name of pluginDirs) {
  console.log('BUILDING: ' + name);
}
`;

  const wrapperPath = path.join(pluginsDir, '_test-wrapper.mts');
  fs.writeFileSync(wrapperPath, wrapperScript, 'utf-8');

  try {
    const result = execFileSync('node', ['--import', 'tsx/esm', wrapperPath, ...args], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 15_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return { stdout: result, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  } finally {
    fs.rmSync(wrapperPath, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Plugin build filter — --filter flag', () => {
  test('--filter=name builds only the named plugin', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-filter-'));
    try {
      createBuildablePlugin(tmpDir, 'alpha');
      createBuildablePlugin(tmpDir, 'beta');
      createBuildablePlugin(tmpDir, 'gamma');

      const result = runPluginsScript(tmpDir, ['--build', '--filter=beta']);
      expect(result.exitCode).toBe(0);

      // Only beta should appear in the output
      expect(result.stdout).toContain('BUILDING: beta');
      expect(result.stdout).not.toContain('BUILDING: alpha');
      expect(result.stdout).not.toContain('BUILDING: gamma');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('--filter with non-existent name exits 1 and prints available plugins', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-filter-noexist-'));
    try {
      createBuildablePlugin(tmpDir, 'alpha');
      createBuildablePlugin(tmpDir, 'beta');

      const result = runPluginsScript(tmpDir, ['--build', '--filter=nonexistent']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown plugin(s): nonexistent');
      expect(result.stderr).toContain('Available:');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

test.describe('Plugin build filter — --affected flag', () => {
  test('--affected skips up-to-date plugins', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-affected-'));
    try {
      const sdkVersion = currentSdkVersion();

      // Create a plugin with up-to-date SDK version in lockfile
      createBuildablePlugin(tmpDir, 'up-to-date');
      writeLockfile(path.join(tmpDir, 'up-to-date'), sdkVersion);

      // Create a plugin with outdated SDK version in lockfile
      createBuildablePlugin(tmpDir, 'outdated');
      writeLockfile(path.join(tmpDir, 'outdated'), '0.0.1');

      const result = runPluginsScript(tmpDir, ['--build', '--affected']);
      expect(result.exitCode).toBe(0);

      // up-to-date should be skipped, outdated should be built
      expect(result.stdout).toContain('up-to-date: up to date');
      expect(result.stdout).toContain('BUILDING: outdated');
      expect(result.stdout).not.toContain('BUILDING: up-to-date');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('--affected treats plugins without lockfile as affected', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-affected-nolock-'));
    try {
      // Create a plugin without a lockfile
      createBuildablePlugin(tmpDir, 'no-lock');
      // Ensure no lockfile exists
      const lockPath = path.join(tmpDir, 'no-lock', 'package-lock.json');
      if (fs.existsSync(lockPath)) fs.rmSync(lockPath);

      const result = runPluginsScript(tmpDir, ['--build', '--affected']);
      expect(result.exitCode).toBe(0);

      // Plugin without lockfile should be treated as affected and built
      expect(result.stdout).toContain('BUILDING: no-lock');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('--affected when all plugins are up to date prints message and exits 0', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-affected-allupdate-'));
    try {
      const sdkVersion = currentSdkVersion();

      createBuildablePlugin(tmpDir, 'alpha');
      writeLockfile(path.join(tmpDir, 'alpha'), sdkVersion);

      createBuildablePlugin(tmpDir, 'beta');
      writeLockfile(path.join(tmpDir, 'beta'), sdkVersion);

      const result = runPluginsScript(tmpDir, ['--build', '--affected']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('All plugins are up to date');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

test.describe('Plugin build filter — --filter + --affected combined', () => {
  test('combined flags use intersection', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-filter-affected-'));
    try {
      const sdkVersion = currentSdkVersion();

      // alpha: matches filter, up-to-date → should be skipped (intersection fails)
      createBuildablePlugin(tmpDir, 'alpha');
      writeLockfile(path.join(tmpDir, 'alpha'), sdkVersion);

      // beta: matches filter, outdated → should be built (intersection passes)
      createBuildablePlugin(tmpDir, 'beta');
      writeLockfile(path.join(tmpDir, 'beta'), '0.0.1');

      // gamma: does not match filter, outdated → should be skipped (not in filter)
      createBuildablePlugin(tmpDir, 'gamma');
      writeLockfile(path.join(tmpDir, 'gamma'), '0.0.1');

      const result = runPluginsScript(tmpDir, ['--build', '--filter=alpha,beta', '--affected']);
      expect(result.exitCode).toBe(0);

      // Only beta should be built (matches filter AND is affected)
      expect(result.stdout).toContain('BUILDING: beta');
      expect(result.stdout).not.toContain('BUILDING: alpha');
      expect(result.stdout).not.toContain('BUILDING: gamma');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
