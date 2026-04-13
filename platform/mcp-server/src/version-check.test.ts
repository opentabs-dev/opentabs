import type * as ChildProcess from 'node:child_process';
import { EventEmitter, PassThrough } from 'node:stream';
import { isWindows } from '@opentabs-dev/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RegisteredPlugin } from './state.js';

// ---- spawn mock via vi.mock ----

/**
 * Minimal mock child process. Uses PassThrough streams so data listeners
 * are attached before any data is pushed.
 */
class MockChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();

  kill(): boolean {
    return true;
  }
}

type SpawnFn = (cmd: string, args: string[], opts: object) => MockChildProcess;

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn<SpawnFn>(),
}));

vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof ChildProcess>()),
  spawn: mockSpawn,
}));

vi.mock('node:url', async importOriginal => {
  const original = await importOriginal<typeof import('node:url')>();
  return {
    ...original,
    fileURLToPath: (url: string) => {
      const real = original.fileURLToPath(url);
      // Make _serverDir include 'node_modules' so isProductionInstall() returns true
      if (real.includes('version-check')) return real.replace('platform/', 'node_modules/platform/');
      return real;
    },
  };
});

const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }));
vi.mock('./telemetry.js', () => ({
  trackEvent: mockTrackEvent,
  getSessionId: vi.fn().mockReturnValue('test-session-id'),
}));

vi.mock('./logger.js', () => ({
  log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Import after mocking so modules pick up the mocked spawn
const { fetchLatestVersion, isNewer, checkForUpdates, checkServerUpdate } = await import('./version-check.js');
const { buildRegistry } = await import('./registry.js');
const { createState } = await import('./state.js');

beforeEach(() => {
  mockSpawn.mockReset();
});

/**
 * Create a mock child process that pushes stdout/stderr data and emits
 * 'close' asynchronously, giving callers time to attach event listeners.
 */
const createMockChild = (exitCode: number, stdout: string, stderr: string): MockChildProcess => {
  const child = new MockChildProcess();
  process.nextTick(() => {
    if (stdout) child.stdout.write(stdout);
    child.stdout.end();
    if (stderr) child.stderr.write(stderr);
    child.stderr.end();
    child.emit('close', exitCode);
  });
  return child;
};

/** Simulate `npm view <pkg> version` returning a given version or failing. */
const mockNpmView = (version: string | undefined): void => {
  mockSpawn.mockImplementation(() =>
    createMockChild(
      version !== undefined ? 0 : 1,
      version !== undefined ? `${version}\n` : '',
      version !== undefined ? '' : 'npm ERR! code E404',
    ),
  );
};

/** Create a minimal RegisteredPlugin for testing */
const makePlugin = (name: string, overrides: Partial<RegisteredPlugin> = {}): RegisteredPlugin => ({
  name,
  version: '1.0.0',
  displayName: name,
  urlPatterns: [`https://${name}.example.com/*`],
  excludePatterns: [],
  source: 'local' as const,
  iife: `(function(){})()`,
  tools: [],
  adapterHash: 'abc123',
  ...overrides,
});

describe('isNewer', () => {
  describe('basic comparisons', () => {
    test('newer major version', () => {
      expect(isNewer('1.0.0', '2.0.0')).toBe(true);
    });

    test('newer minor version', () => {
      expect(isNewer('1.0.0', '1.1.0')).toBe(true);
    });

    test('newer patch version', () => {
      expect(isNewer('1.0.0', '1.0.1')).toBe(true);
    });

    test('same version', () => {
      expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    });

    test('older major version', () => {
      expect(isNewer('2.0.0', '1.0.0')).toBe(false);
    });

    test('older minor version', () => {
      expect(isNewer('1.1.0', '1.0.0')).toBe(false);
    });

    test('older patch version', () => {
      expect(isNewer('1.0.1', '1.0.0')).toBe(false);
    });
  });

  describe('v prefix handling', () => {
    test('strips v prefix from current', () => {
      expect(isNewer('v1.0.0', '2.0.0')).toBe(true);
    });

    test('strips v prefix from latest', () => {
      expect(isNewer('1.0.0', 'v2.0.0')).toBe(true);
    });

    test('strips v prefix from both', () => {
      expect(isNewer('v1.0.0', 'v1.0.0')).toBe(false);
    });
  });

  describe('prerelease handling', () => {
    test('prerelease suffix is stripped for comparison (1.0.0-beta.1 treated as 1.0.0)', () => {
      expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false);
    });

    test('prerelease current vs newer release', () => {
      expect(isNewer('1.0.0-beta.1', '1.0.1')).toBe(true);
    });

    test('prerelease latest vs same base release', () => {
      expect(isNewer('2.0.0', '2.0.0-rc.1')).toBe(false);
    });

    test('prerelease does not cause NaN', () => {
      expect(isNewer('0.9.0', '1.0.0-beta.1')).toBe(true);
    });
  });

  describe('NaN segment handling', () => {
    test('malformed current segment treated as 0 (latest is newer)', () => {
      expect(isNewer('1.0.abc', '2.0.0')).toBe(true);
    });

    test('malformed latest segment treated as 0 (current is newer)', () => {
      expect(isNewer('2.0.0', '1.0.abc')).toBe(false);
    });

    test('both versions have malformed segments', () => {
      expect(isNewer('1.abc.0', '2.xyz.0')).toBe(true);
    });

    test('malformed segment in same position compares as equal (both become 0)', () => {
      expect(isNewer('1.abc.0', '1.xyz.0')).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('missing patch version treated as 0', () => {
      expect(isNewer('1.0', '1.0.1')).toBe(true);
    });

    test('handles large version numbers', () => {
      expect(isNewer('1.999.999', '2.0.0')).toBe(true);
    });

    test('major version difference dominates', () => {
      expect(isNewer('1.99.99', '2.0.0')).toBe(true);
      expect(isNewer('2.0.0', '1.99.99')).toBe(false);
    });
  });
});

describe('fetchLatestVersion', () => {
  test('passes package name to npm view', async () => {
    mockSpawn.mockImplementation(() => createMockChild(0, '2.0.0\n', ''));

    await fetchLatestVersion('my-package');
    expect(mockSpawn).toHaveBeenCalledWith('npm', ['view', 'my-package', 'version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows(),
    });
  });

  test('scoped package name is passed directly', async () => {
    mockSpawn.mockImplementation(() => createMockChild(0, '1.2.3\n', ''));

    await fetchLatestVersion('@opentabs-dev/plugin-sdk');
    expect(mockSpawn).toHaveBeenCalledWith('npm', ['view', '@opentabs-dev/plugin-sdk', 'version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows(),
    });
  });

  test('successful npm view returns version string', async () => {
    mockNpmView('3.1.4');
    const result = await fetchLatestVersion('some-package');
    expect(result).toBe('3.1.4');
  });

  test('non-zero exit code returns null', async () => {
    mockNpmView(undefined);
    const result = await fetchLatestVersion('missing-package');
    expect(result).toBeNull();
  });

  test('empty stdout returns null', async () => {
    mockSpawn.mockImplementation(() => createMockChild(0, '', ''));

    const result = await fetchLatestVersion('some-package');
    expect(result).toBeNull();
  });

  test('spawn error returns null', async () => {
    mockSpawn.mockImplementation(() => {
      const child = new MockChildProcess();
      process.nextTick(() => child.emit('error', new Error('spawn failed')));
      return child;
    });

    const result = await fetchLatestVersion('some-package');
    expect(result).toBeNull();
  });
});

describe('checkForUpdates', () => {
  test('local plugins (no npmPackageName) are skipped', async () => {
    mockSpawn.mockImplementation(() => createMockChild(0, '2.0.0\n', ''));

    const state = createState();
    state.registry = buildRegistry([makePlugin('local-plugin', { npmPackageName: undefined })], []);

    await checkForUpdates(state);

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('outdated npm plugin is added to state.outdatedPlugins', async () => {
    mockNpmView('2.0.0');

    const state = createState();
    state.registry = buildRegistry(
      [makePlugin('my-plugin', { version: '1.0.0', npmPackageName: 'opentabs-plugin-my', source: 'npm' })],
      [],
    );

    await checkForUpdates(state);

    expect(state.outdatedPlugins).toHaveLength(1);
    expect(state.outdatedPlugins[0]?.name).toBe('opentabs-plugin-my');
    expect(state.outdatedPlugins[0]?.currentVersion).toBe('1.0.0');
    expect(state.outdatedPlugins[0]?.latestVersion).toBe('2.0.0');
  });

  test('up-to-date plugin is NOT added to state.outdatedPlugins', async () => {
    mockNpmView('1.0.0');

    const state = createState();
    state.registry = buildRegistry(
      [makePlugin('my-plugin', { version: '1.0.0', npmPackageName: 'opentabs-plugin-my', source: 'npm' })],
      [],
    );

    await checkForUpdates(state);

    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('fetchLatestVersion returning null does not add to outdatedPlugins', async () => {
    mockNpmView(undefined);

    const state = createState();
    state.registry = buildRegistry(
      [makePlugin('my-plugin', { version: '1.0.0', npmPackageName: 'opentabs-plugin-my', source: 'npm' })],
      [],
    );

    await checkForUpdates(state);

    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('empty plugins map results in empty outdatedPlugins', async () => {
    const state = createState();
    await checkForUpdates(state);
    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('mixed results: outdated + failed npm view', async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createMockChild(0, '2.0.0\n', '');
      }
      return createMockChild(1, '', 'npm ERR! code E404');
    });

    const state = createState();
    state.registry = buildRegistry(
      [
        makePlugin('plugin-a', { version: '1.0.0', npmPackageName: 'opentabs-plugin-a', source: 'npm' }),
        makePlugin('plugin-b', { version: '1.0.0', npmPackageName: 'opentabs-plugin-b', source: 'npm' }),
      ],
      [],
    );

    await checkForUpdates(state);

    // plugin-a gets version 2.0.0 (outdated), plugin-b npm view fails (skipped)
    expect(state.outdatedPlugins).toHaveLength(1);
    expect(state.outdatedPlugins[0]?.name).toBe('opentabs-plugin-a');
  });
});

// ---------------------------------------------------------------------------
// Telemetry: server_update_available event
// ---------------------------------------------------------------------------

describe('checkServerUpdate telemetry', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockTrackEvent.mockClear();
  });

  test('server_update_available is emitted when a newer version is detected', async () => {
    mockNpmView('99.0.0');

    const state = createState();
    await checkServerUpdate(state);

    expect(mockTrackEvent).toHaveBeenCalledWith('server_update_available', {
      session_id: 'test-session-id',
    });
  });

  test('server_update_available is not emitted when version is up-to-date', async () => {
    // Return the same version as current — isNewer will be false
    mockNpmView('0.0.0');

    const state = createState();
    await checkServerUpdate(state);

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  test('server_update_available event has no version numbers in properties', async () => {
    mockNpmView('99.0.0');

    const state = createState();
    await checkServerUpdate(state);

    const calls = mockTrackEvent.mock.calls;
    for (const [, props] of calls) {
      const p = props as Record<string, unknown>;
      expect(p).not.toHaveProperty('version');
      expect(p).not.toHaveProperty('current_version');
      expect(p).not.toHaveProperty('latest_version');
      expect(p).not.toHaveProperty('package_name');
    }
  });
});
