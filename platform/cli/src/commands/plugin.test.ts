import {
  buildDirectLookupCandidates,
  KNOWN_OFFICIAL_PLUGIN_SLUGS,
  parseMaintainer,
  removeFromLocalPlugins,
  resolvePackageName,
  warnIfNotPlugin,
} from './plugin.js';
import {
  normalizePluginName,
  resolvePluginPackageCandidates,
  OFFICIAL_SCOPE,
  PLUGIN_PREFIX,
} from '@opentabs-dev/shared';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MockInstance } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

/** Create a mock spawn child process that emits stdout data and closes immediately. */
const createMockChild = (exitCode: number, stdoutData: string): EventEmitter => {
  const child = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  (child as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }).stdout = stdoutEmitter;
  (child as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }).stderr = stderrEmitter;
  setImmediate(() => {
    stdoutEmitter.emit('data', Buffer.from(stdoutData));
    child.emit('close', exitCode);
  });
  return child;
};

// ---------------------------------------------------------------------------
// buildDirectLookupCandidates
// ---------------------------------------------------------------------------

describe('buildDirectLookupCandidates', () => {
  test('returns known official plugin packages when no query is provided', () => {
    const expected = KNOWN_OFFICIAL_PLUGIN_SLUGS.map(slug => `${OFFICIAL_SCOPE}/${PLUGIN_PREFIX}${slug}`);
    expect(buildDirectLookupCandidates()).toEqual(expected);
    expect(buildDirectLookupCandidates(undefined)).toEqual(expected);
  });

  test('returns official and community candidates for a shorthand query', () => {
    expect(buildDirectLookupCandidates('slack')).toEqual([
      '@opentabs-dev/opentabs-plugin-slack',
      'opentabs-plugin-slack',
    ]);
  });

  test('returns multi-word shorthand candidates', () => {
    expect(buildDirectLookupCandidates('my-tool')).toEqual([
      '@opentabs-dev/opentabs-plugin-my-tool',
      'opentabs-plugin-my-tool',
    ]);
  });

  test('returns scoped name as-is when query starts with @', () => {
    expect(buildDirectLookupCandidates('@my-org/opentabs-plugin-jira')).toEqual(['@my-org/opentabs-plugin-jira']);
  });

  test('returns full unscoped name as-is when query starts with opentabs-plugin-', () => {
    expect(buildDirectLookupCandidates('opentabs-plugin-slack')).toEqual(['opentabs-plugin-slack']);
  });
});

// ---------------------------------------------------------------------------
// parseMaintainer
// ---------------------------------------------------------------------------

describe('parseMaintainer', () => {
  test('extracts name from string with email in angle brackets', () => {
    expect(parseMaintainer('opentabs-dev-admin <admin@example.com>')).toBe('opentabs-dev-admin');
  });

  test('returns trimmed string when no angle bracket is present', () => {
    expect(parseMaintainer('opentabs-dev-admin')).toBe('opentabs-dev-admin');
  });

  test('returns undefined for empty array (no first element)', () => {
    expect(parseMaintainer(undefined)).toBeUndefined();
  });

  test('extracts name from object with name field (backwards compatibility)', () => {
    expect(parseMaintainer({ name: 'alice', email: 'alice@example.com' })).toBe('alice');
  });

  test('extracts username from object without name field', () => {
    expect(parseMaintainer({ username: 'alice' })).toBe('alice');
  });

  test('returns undefined for object with neither name nor username', () => {
    expect(parseMaintainer({ email: 'alice@example.com' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizePluginName (re-exported from shared)
// ---------------------------------------------------------------------------

describe('normalizePluginName (re-exported from shared)', () => {
  test('shorthand "slack" maps to official scoped package', () => {
    expect(normalizePluginName('slack')).toBe('@opentabs-dev/opentabs-plugin-slack');
  });

  test('full name passes through', () => {
    expect(normalizePluginName('opentabs-plugin-slack')).toBe('opentabs-plugin-slack');
  });

  test('scoped name passes through', () => {
    expect(normalizePluginName('@company/opentabs-plugin-foo')).toBe('@company/opentabs-plugin-foo');
  });
});

// ---------------------------------------------------------------------------
// resolvePluginPackageCandidates (re-exported from shared)
// ---------------------------------------------------------------------------

describe('resolvePluginPackageCandidates (re-exported from shared)', () => {
  test('shorthand returns two candidates: official first, then community', () => {
    const candidates = resolvePluginPackageCandidates('slack');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe('@opentabs-dev/opentabs-plugin-slack');
    expect(candidates[1]).toBe('opentabs-plugin-slack');
  });

  test('already-qualified names return single candidate', () => {
    expect(resolvePluginPackageCandidates('opentabs-plugin-slack')).toHaveLength(1);
    expect(resolvePluginPackageCandidates('@opentabs-dev/opentabs-plugin-slack')).toHaveLength(1);
    expect(resolvePluginPackageCandidates('@myorg/opentabs-plugin-jira')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolvePackageName
// ---------------------------------------------------------------------------

describe('resolvePackageName', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  test('returns scoped package as-is without npm check', async () => {
    const result = await resolvePackageName('@my-org/opentabs-plugin-foo');
    expect(result).toBe('@my-org/opentabs-plugin-foo');
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  test('returns full opentabs-plugin- name as-is without npm check', async () => {
    const result = await resolvePackageName('opentabs-plugin-slack');
    expect(result).toBe('opentabs-plugin-slack');
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  test('resolves bare name to official scoped package when it exists', async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(0, '1.0.0\n') as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(0, '1.0.0\n') as ReturnType<typeof spawn>);
    const result = await resolvePackageName('slack');
    expect(result).toBe('@opentabs-dev/opentabs-plugin-slack');
  });

  test('resolves bare name to community package when official is not found', async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(1, '') as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(0, '2.0.0\n') as ReturnType<typeof spawn>);
    const result = await resolvePackageName('slack');
    expect(result).toBe('opentabs-plugin-slack');
  });

  test('returns null when no candidate exists for bare name', async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(1, '') as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(1, '') as ReturnType<typeof spawn>);
    const result = await resolvePackageName('nonexistent');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// warnIfNotPlugin
// ---------------------------------------------------------------------------

describe('warnIfNotPlugin', () => {
  const warnTestDir = mkdtempSync(join(tmpdir(), 'opentabs-warn-test-'));

  afterAll(() => {
    rmSync(warnTestDir, { recursive: true, force: true });
  });

  let consoleSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('warns when package lacks opentabs metadata', async () => {
    const pkgDir = join(warnTestDir, 'no-metadata-pkg');
    mkdirSync(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'no-metadata-pkg', version: '1.0.0' }),
      'utf-8',
    );
    vi.mocked(spawn).mockImplementationOnce(() => createMockChild(0, `${warnTestDir}\n`) as ReturnType<typeof spawn>);

    await warnIfNotPlugin('no-metadata-pkg');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('does not appear to be an OpenTabs plugin'));
  });

  test('does not warn when package has opentabs field', async () => {
    const pkgDir = join(warnTestDir, 'opentabs-field-pkg');
    mkdirSync(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'opentabs-field-pkg', version: '1.0.0', opentabs: { displayName: 'My Plugin' } }),
      'utf-8',
    );
    vi.mocked(spawn).mockImplementationOnce(() => createMockChild(0, `${warnTestDir}\n`) as ReturnType<typeof spawn>);

    await warnIfNotPlugin('opentabs-field-pkg');

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test('does not warn when package has opentabs-plugin keyword', async () => {
    const pkgDir = join(warnTestDir, 'keyword-pkg');
    mkdirSync(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'keyword-pkg', version: '1.0.0', keywords: ['opentabs-plugin'] }),
      'utf-8',
    );
    vi.mocked(spawn).mockImplementationOnce(() => createMockChild(0, `${warnTestDir}\n`) as ReturnType<typeof spawn>);

    await warnIfNotPlugin('keyword-pkg');

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test('silently ignores errors when package.json is unreadable', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => createMockChild(0, `${warnTestDir}\n`) as ReturnType<typeof spawn>);

    await warnIfNotPlugin('pkg-does-not-exist');

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeFromLocalPlugins
// ---------------------------------------------------------------------------

describe('removeFromLocalPlugins', () => {
  let testDir: string;
  const savedConfigDir = process.env.OPENTABS_CONFIG_DIR;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'opentabs-remove-test-'));
    process.env.OPENTABS_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    if (savedConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = savedConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
  });

  test('removes local plugin entry when package name matches', async () => {
    const pluginDir = join(testDir, 'my-plugin');
    mkdirSync(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: 'opentabs-plugin-my' }), 'utf-8');
    await writeFile(join(testDir, 'config.json'), JSON.stringify({ localPlugins: [pluginDir] }) + '\n', 'utf-8');

    await removeFromLocalPlugins('opentabs-plugin-my');

    const updated = JSON.parse(await readFile(join(testDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated.localPlugins).toEqual([]);
  });

  test('keeps entry when package.json is unreadable (path does not exist)', async () => {
    const missingDir = join(testDir, 'nonexistent-plugin');
    await writeFile(join(testDir, 'config.json'), JSON.stringify({ localPlugins: [missingDir] }) + '\n', 'utf-8');

    await removeFromLocalPlugins('opentabs-plugin-nonexistent');

    const updated = JSON.parse(await readFile(join(testDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated.localPlugins).toEqual([missingDir]);
  });

  test('does nothing when localPlugins is empty', async () => {
    await writeFile(join(testDir, 'config.json'), JSON.stringify({ localPlugins: [] }) + '\n', 'utf-8');

    await removeFromLocalPlugins('opentabs-plugin-any');

    const updated = JSON.parse(await readFile(join(testDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated.localPlugins).toEqual([]);
  });

  test('removes only matching entry and keeps other plugins', async () => {
    const plugin1Dir = join(testDir, 'plugin-one');
    const plugin2Dir = join(testDir, 'plugin-two');
    mkdirSync(plugin1Dir, { recursive: true });
    mkdirSync(plugin2Dir, { recursive: true });
    await writeFile(join(plugin1Dir, 'package.json'), JSON.stringify({ name: 'opentabs-plugin-one' }), 'utf-8');
    await writeFile(join(plugin2Dir, 'package.json'), JSON.stringify({ name: 'opentabs-plugin-two' }), 'utf-8');
    await writeFile(
      join(testDir, 'config.json'),
      JSON.stringify({ localPlugins: [plugin1Dir, plugin2Dir] }) + '\n',
      'utf-8',
    );

    await removeFromLocalPlugins('opentabs-plugin-one');

    const updated = JSON.parse(await readFile(join(testDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated.localPlugins).toEqual([plugin2Dir]);
  });

  test('resolves relative paths when matching local plugin entries', async () => {
    const pluginRelPath = 'rel-plugin';
    const pluginAbsDir = join(testDir, pluginRelPath);
    mkdirSync(pluginAbsDir, { recursive: true });
    await writeFile(join(pluginAbsDir, 'package.json'), JSON.stringify({ name: 'opentabs-plugin-rel' }), 'utf-8');
    await writeFile(join(testDir, 'config.json'), JSON.stringify({ localPlugins: [pluginRelPath] }) + '\n', 'utf-8');

    await removeFromLocalPlugins('opentabs-plugin-rel');

    const updated = JSON.parse(await readFile(join(testDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated.localPlugins).toEqual([]);
  });
});
