import type * as ChildProcess from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { isErr, isOk } from '@opentabs-dev/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { discoverGlobalNpmPlugins, isAllowedPluginPath, resetGlobalPathsCache, resolvePluginPath } from './resolver.js';

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

/**
 * Unit tests for the plugin resolver module.
 *
 * Tests resolvePluginPath() for local path resolution (absolute, relative, ~/),
 * npm package resolution, and security validation. Also tests isAllowedPluginPath()
 * and discoverGlobalNpmPlugins() as the canonical test file for resolver.ts exports.
 */

/** Helper to create a valid plugin directory structure */
const createPluginDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'opentabs-plugin-test',
      version: '1.0.0',
      main: 'dist/adapter.iife.js',
      opentabs: { displayName: 'Test', description: 'A test plugin', urlPatterns: ['http://localhost/*'] },
    }),
  );
};

describe('resolvePluginPath — local absolute paths', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opentabs-resolver-path-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('resolves a valid absolute path to an existing directory', async () => {
    const pluginDir = join(tempDir, 'my-plugin');
    createPluginDir(pluginDir);

    const result = await resolvePluginPath(pluginDir, tempDir);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(pluginDir);
    }
  });

  test('returns error for non-existent absolute path', async () => {
    const nonExistent = join(tempDir, 'does-not-exist');

    const result = await resolvePluginPath(nonExistent, tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('Path not found');
      expect(result.error).toContain(nonExistent);
    }
  });

  test('returns error when path is a file, not a directory', async () => {
    const filePath = join(tempDir, 'a-file');
    writeFileSync(filePath, 'not a directory');

    const result = await resolvePluginPath(filePath, tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('not a directory');
    }
  });

  test('returns error for path outside allowed directories', async () => {
    const result = await resolvePluginPath('/etc/evil-plugin', '/etc');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('outside allowed directories');
    }
  });
});

describe('resolvePluginPath — local relative paths', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opentabs-resolver-rel-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('resolves ./ relative path against configDir', async () => {
    const pluginDir = join(tempDir, 'my-plugin');
    createPluginDir(pluginDir);

    const result = await resolvePluginPath('./my-plugin', tempDir);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(resolve(tempDir, 'my-plugin'));
    }
  });

  test('resolves ../ relative path against configDir', async () => {
    const configDir = join(tempDir, 'config');
    mkdirSync(configDir, { recursive: true });
    const pluginDir = join(tempDir, 'my-plugin');
    createPluginDir(pluginDir);

    const result = await resolvePluginPath('../my-plugin', join(tempDir, 'config'));

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(resolve(join(tempDir, 'config'), '../my-plugin'));
    }
  });

  test('returns error for relative path pointing to non-existent directory', async () => {
    const result = await resolvePluginPath('./missing', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('Path not found');
    }
  });
});

describe('resolvePluginPath — ~/ home directory paths', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opentabs-resolver-home-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('resolves ~/ path relative to home directory', async () => {
    // We can't create arbitrary dirs under $HOME, but we can verify the resolved path
    const result = await resolvePluginPath('~/nonexistent-plugin-dir-for-test', tempDir);

    // The path resolves but the directory doesn't exist, so we get a "not found" error
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain(homedir());
    }
  });

  test('resolves ~\\ path relative to home directory (Windows)', async () => {
    const result = await resolvePluginPath('~\\nonexistent-plugin-dir-for-test', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      // Expanded via homedir(), so the error references the home directory path
      expect(result.error).toContain(homedir());
    }
  });
});

describe('resolvePluginPath — npm package specifiers', () => {
  let tempDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opentabs-resolver-npm-pkg-'));
    originalCwd = process.cwd.bind(process);
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('resolves npm package via require.resolve', async () => {
    const pkgDir = join(tempDir, 'node_modules', 'opentabs-plugin-slack');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'opentabs-plugin-slack' }));

    const result = await resolvePluginPath('opentabs-plugin-slack', '/some/config');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // Canonicalize both paths — require.resolve may or may not resolve symlinks (macOS /var → /private/var)
      expect(realpathSync(result.value)).toBe(realpathSync(pkgDir));
    }
  });

  test('returns error for npm package not found', async () => {
    const result = await resolvePluginPath('opentabs-plugin-nonexistent', '/some/config');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('Package not found');
      expect(result.error).toContain('opentabs-plugin-nonexistent');
    }
  });

  test('resolves scoped npm package', async () => {
    const pkgDir = join(tempDir, 'node_modules', '@myorg', 'opentabs-plugin-jira');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@myorg/opentabs-plugin-jira' }));

    const result = await resolvePluginPath('@myorg/opentabs-plugin-jira', '/some/config');

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(realpathSync(result.value)).toBe(realpathSync(pkgDir));
    }
  });
});

describe('resolvePluginPath — specifier format detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opentabs-resolver-spec-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('./ prefix is treated as local path', async () => {
    const pluginDir = join(tempDir, 'local-plugin');
    createPluginDir(pluginDir);

    const result = await resolvePluginPath('./local-plugin', tempDir);

    expect(isOk(result)).toBe(true);
  });

  test('../ prefix is treated as local path', async () => {
    const parentPluginDir = join(tempDir, 'parent-plugin');
    createPluginDir(parentPluginDir);

    const dirName = basename(tempDir);
    const result = await resolvePluginPath(`../${dirName}/parent-plugin`, tempDir);

    expect(isOk(result)).toBe(true);
  });

  test('/ prefix is treated as local path', async () => {
    const pluginDir = join(tempDir, 'abs-plugin');
    createPluginDir(pluginDir);

    const result = await resolvePluginPath(pluginDir, '/different/config');

    expect(isOk(result)).toBe(true);
  });

  test('~/ prefix is treated as local path', async () => {
    // ~/ is treated as local — resolves relative to homedir, not as npm
    const result = await resolvePluginPath('~/nonexistent-test-plugin', tempDir);

    // Should fail with a local-path-style error, not "Package not found"
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).not.toContain('Package not found');
    }
  });

  test('~\\ prefix is treated as local path (Windows)', async () => {
    const result = await resolvePluginPath('~\\nonexistent-test-plugin', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).not.toContain('Package not found');
    }
  });

  test('.\\ prefix is treated as local path (Windows)', async () => {
    const result = await resolvePluginPath('.\\my-plugin', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).not.toContain('Package not found');
    }
  });

  test('..\\ prefix is treated as local path (Windows)', async () => {
    const result = await resolvePluginPath('..\\my-plugin', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).not.toContain('Package not found');
    }
  });

  test('drive letter C:\\ is treated as local path (Windows)', async () => {
    const result = await resolvePluginPath('C:\\Users\\dev\\plugins\\foo', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).not.toContain('Package not found');
    }
  });

  test('drive letter D:/ is treated as local path (Windows)', async () => {
    const result = await resolvePluginPath('D:/projects/my-plugin', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).not.toContain('Package not found');
    }
  });

  test('bare name is treated as npm package specifier', async () => {
    const result = await resolvePluginPath('opentabs-plugin-test', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('Package not found');
    }
  });

  test('scoped package name is treated as npm package specifier', async () => {
    const result = await resolvePluginPath('@scope/opentabs-plugin-foo', tempDir);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toContain('Package not found');
    }
  });
});

describe('isAllowedPluginPath', () => {
  test('allows path under home directory', async () => {
    const path = join(homedir(), '.opentabs', 'plugins', 'test');
    expect(await isAllowedPluginPath(path)).toBe(true);
  });

  test('allows path under temp directory', async () => {
    const path = join(tmpdir(), 'opentabs-test', 'plugin');
    expect(await isAllowedPluginPath(path)).toBe(true);
  });

  test('rejects path outside allowed directories', async () => {
    expect(await isAllowedPluginPath('/etc/evil-plugin')).toBe(false);
  });

  test('rejects root path', async () => {
    expect(await isAllowedPluginPath('/')).toBe(false);
  });

  test('allows exact home directory', async () => {
    expect(await isAllowedPluginPath(homedir())).toBe(true);
  });

  test('uses separator boundary — string prefix without separator is rejected', async () => {
    // getAllowedRoots includes tmpdir (always '/tmp' on POSIX).
    // '/tmpevil' shares the string prefix '/tmp' but is NOT a child of it
    // because it lacks the path separator. This verifies the check compares
    // against `root + sep`, not just `root`.
    expect(await isAllowedPluginPath('/tmpevil')).toBe(false);
  });

  test('rejects path with .. traversal that escapes home', async () => {
    // resolve() normalizes .., but the resulting path must still be under an allowed root
    expect(await isAllowedPluginPath('/var/data/../../../etc/passwd')).toBe(false);
  });
});

describe('discoverGlobalNpmPlugins', () => {
  let tempDir: string;

  /** Type for the execFile mock — simplified to the overload signature resolver.ts uses */
  type ExecFileFn = (
    file: string,
    args: string[],
    callback: (err: Error | null, stdout: string, stderr: string) => void,
  ) => void;
  const mockedExecFile = execFile as unknown as ReturnType<typeof vi.fn<ExecFileFn>>;

  /** Mock result shape for handler functions */
  const execResult = (status: number, stdout: string): { status: number; stdout: string } => ({ status, stdout });

  /** Write a valid opentabs plugin package.json */
  const writePluginPkgJson = (dir: string, name: string): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        main: 'dist/adapter.iife.js',
        opentabs: { displayName: name, description: 'Test plugin', urlPatterns: ['*://*.example.com/*'] },
      }),
    );
  };

  /** Write a package.json without the opentabs field */
  const writeNonPluginPkgJson = (dir: string, name: string): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  };

  /** Install a mock for node:child_process execFile that delegates to the given handler.
   *  The handler receives `[command, ...args]` to match the test's existing cmd-array pattern.
   *  Handles both 3-arg (command, args, callback) and 4-arg (command, args, options, callback)
   *  overloads — the production code passes { shell: isWindows() } as options. */
  const mockExecFile = (handler: (cmd: string[]) => { status: number; stdout: string }): void => {
    mockedExecFile.mockImplementation((...callArgs: unknown[]) => {
      const command = callArgs[0] as string;
      const args = callArgs[1] as string[];
      // callback is the last argument (3rd or 4th depending on whether options is present)
      const callback = callArgs[callArgs.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
      const result = handler([command, ...args]);
      if (result.status === 0) {
        callback(null, result.stdout, '');
      } else {
        callback(Object.assign(new Error('Command failed'), { code: result.status }), '', '');
      }
    });
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opentabs-resolver-npm-'));
    mockedExecFile.mockReset();
    resetGlobalPathsCache();
  });

  afterEach(() => {
    mockedExecFile.mockRestore();
    resetGlobalPathsCache();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('discovers unscoped opentabs-plugin-* packages', async () => {
    const globalDir = join(tempDir, 'node_modules');
    writePluginPkgJson(join(globalDir, 'opentabs-plugin-slack'), 'opentabs-plugin-slack');

    mockExecFile(cmd => {
      if (cmd[0] === 'npm' && cmd[1] === 'root') return execResult(0, globalDir);
      return execResult(1, '');
    });

    const { dirs, errors } = await discoverGlobalNpmPlugins();

    expect(errors).toHaveLength(0);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(globalDir, 'opentabs-plugin-slack'));
  });

  test('discovers scoped @org/opentabs-plugin-* packages', async () => {
    const globalDir = join(tempDir, 'node_modules');
    writePluginPkgJson(join(globalDir, '@myorg', 'opentabs-plugin-foo'), '@myorg/opentabs-plugin-foo');

    mockExecFile(cmd => {
      if (cmd[0] === 'npm' && cmd[1] === 'root') return execResult(0, globalDir);
      return execResult(1, '');
    });

    const { dirs, errors } = await discoverGlobalNpmPlugins();

    expect(errors).toHaveLength(0);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(globalDir, '@myorg', 'opentabs-plugin-foo'));
  });

  test('skips packages without opentabs field', async () => {
    const globalDir = join(tempDir, 'node_modules');
    writePluginPkgJson(join(globalDir, 'opentabs-plugin-valid'), 'opentabs-plugin-valid');
    writeNonPluginPkgJson(join(globalDir, 'opentabs-plugin-no-field'), 'opentabs-plugin-no-field');

    mockExecFile(cmd => {
      if (cmd[0] === 'npm' && cmd[1] === 'root') return execResult(0, globalDir);
      return execResult(1, '');
    });

    const { dirs } = await discoverGlobalNpmPlugins();

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(globalDir, 'opentabs-plugin-valid'));
  });

  test('ignores non-plugin packages', async () => {
    const globalDir = join(tempDir, 'node_modules');
    writeNonPluginPkgJson(join(globalDir, 'express'), 'express');
    writeNonPluginPkgJson(join(globalDir, 'lodash'), 'lodash');
    writePluginPkgJson(join(globalDir, 'opentabs-plugin-only'), 'opentabs-plugin-only');

    mockExecFile(cmd => {
      if (cmd[0] === 'npm' && cmd[1] === 'root') return execResult(0, globalDir);
      return execResult(1, '');
    });

    const { dirs } = await discoverGlobalNpmPlugins();
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(globalDir, 'opentabs-plugin-only'));
  });

  test('returns empty when no global paths are available', async () => {
    mockExecFile(() => execResult(1, ''));

    const { dirs, errors } = await discoverGlobalNpmPlugins();

    expect(dirs).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  test('returns empty when global directory does not exist', async () => {
    mockExecFile(cmd => {
      if (cmd[0] === 'npm' && cmd[1] === 'root') return execResult(0, join(tempDir, 'nonexistent'));
      return execResult(1, '');
    });

    const { dirs, errors } = await discoverGlobalNpmPlugins();

    expect(dirs).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  test('deduplicates plugins when the same path appears multiple times in global paths', async () => {
    const globalDir = join(tempDir, 'node_modules');
    writePluginPkgJson(join(globalDir, 'opentabs-plugin-slack'), 'opentabs-plugin-slack');

    // Inject the same global path twice to exercise the deduplication logic
    (globalThis as Record<string, unknown>).__opentabs_global_paths__ = [globalDir, globalDir];

    const { dirs } = await discoverGlobalNpmPlugins();

    expect(dirs).toHaveLength(1);
  });

  test('retries npm root -g on next call when previous call returned empty paths', async () => {
    const globalDir = join(tempDir, 'node_modules');
    writePluginPkgJson(join(globalDir, 'opentabs-plugin-slack'), 'opentabs-plugin-slack');

    // First call: npm fails (empty result, no path recorded)
    // Second call: npm succeeds
    let callCount = 0;
    mockedExecFile.mockImplementation((...callArgs: unknown[]) => {
      const command = callArgs[0] as string;
      const args = callArgs[1] as string[];
      const callback = callArgs[callArgs.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
      if (command === 'npm' && args[0] === 'root') {
        callCount++;
        if (callCount === 1) {
          callback(Object.assign(new Error('Command failed'), { code: 1 }), '', '');
        } else {
          callback(null, globalDir, '');
        }
      } else {
        callback(Object.assign(new Error('Command failed'), { code: 1 }), '', '');
      }
    });

    const first = await discoverGlobalNpmPlugins();
    expect(first.dirs).toHaveLength(0);

    const execFileCallsAfterFirst = mockedExecFile.mock.calls.length;

    const second = await discoverGlobalNpmPlugins();
    // Second call must invoke execFile again — empty result was not cached
    expect(mockedExecFile.mock.calls.length).toBeGreaterThan(execFileCallsAfterFirst);
    expect(second.dirs).toHaveLength(1);
    expect(second.dirs[0]).toBe(join(globalDir, 'opentabs-plugin-slack'));
  });

  test('caches global paths across calls', async () => {
    const globalDir = join(tempDir, 'node_modules');
    mkdirSync(globalDir, { recursive: true });

    mockedExecFile.mockImplementation((...callArgs: unknown[]) => {
      const command = callArgs[0] as string;
      const args = callArgs[1] as string[];
      const callback = callArgs[callArgs.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
      if (command === 'npm' && args[0] === 'root') {
        callback(null, globalDir, '');
      } else {
        callback(Object.assign(new Error('Command failed'), { code: 1 }), '', '');
      }
    });

    await discoverGlobalNpmPlugins();
    const firstCallCount = mockedExecFile.mock.calls.length;

    await discoverGlobalNpmPlugins();
    // Second call should not invoke execFile again due to caching
    expect(mockedExecFile.mock.calls.length).toBe(firstCallCount);
  });
});
