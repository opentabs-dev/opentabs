import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePluginName, pluginNameFromPackage, resolvePluginPackageCandidates } from '@opentabs-dev/shared';
import type { MockInstance } from 'vitest';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildDirectLookupCandidates,
  findPluginDir,
  readLocalPluginInfo,
  readPluginConfigSchema,
  removeFromLocalPlugins,
  resolvePackageName,
  scanNpmPlugins,
  warnIfNotPlugin,
} from './plugin.js';

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
  test('returns empty array when no query is provided', () => {
    expect(buildDirectLookupCandidates()).toEqual([]);
    expect(buildDirectLookupCandidates(undefined)).toEqual([]);
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

  test('returns scoped and unscoped variants when query starts with opentabs-plugin-', () => {
    expect(buildDirectLookupCandidates('opentabs-plugin-slack')).toEqual([
      '@opentabs-dev/opentabs-plugin-slack',
      'opentabs-plugin-slack',
    ]);
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
    await writeFile(join(testDir, 'config.json'), `${JSON.stringify({ localPlugins: [pluginDir] })}\n`, 'utf-8');

    await removeFromLocalPlugins('opentabs-plugin-my');

    const updated = JSON.parse(await readFile(join(testDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated.localPlugins).toEqual([]);
  });

  test('keeps entry when package.json is unreadable (path does not exist)', async () => {
    const missingDir = join(testDir, 'nonexistent-plugin');
    await writeFile(join(testDir, 'config.json'), `${JSON.stringify({ localPlugins: [missingDir] })}\n`, 'utf-8');

    await removeFromLocalPlugins('opentabs-plugin-nonexistent');

    const updated = JSON.parse(await readFile(join(testDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated.localPlugins).toEqual([missingDir]);
  });

  test('does nothing when localPlugins is empty', async () => {
    await writeFile(join(testDir, 'config.json'), `${JSON.stringify({ localPlugins: [] })}\n`, 'utf-8');

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
      `${JSON.stringify({ localPlugins: [plugin1Dir, plugin2Dir] })}\n`,
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
    await writeFile(join(testDir, 'config.json'), `${JSON.stringify({ localPlugins: [pluginRelPath] })}\n`, 'utf-8');

    await removeFromLocalPlugins('opentabs-plugin-rel');

    const updated = JSON.parse(await readFile(join(testDir, 'config.json'), 'utf-8')) as Record<string, unknown>;
    expect(updated.localPlugins).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readLocalPluginInfo
// ---------------------------------------------------------------------------

describe('readLocalPluginInfo', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'opentabs-readinfo-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('reads displayName from opentabs.displayName in package.json', async () => {
    const pluginDir = join(testDir, 'opentabs-plugin-slack');
    mkdirSync(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'opentabs-plugin-slack', version: '1.2.3', opentabs: { displayName: 'Slack' } }),
      'utf-8',
    );

    const info = await readLocalPluginInfo(pluginDir);

    expect(info?.displayName).toBe('Slack');
    expect(info?.name).toBe('opentabs-plugin-slack');
    expect(info?.version).toBe('1.2.3');
    expect(info?.toolCount).toBe(0);
  });

  test('falls back to package name as displayName when opentabs field is absent', async () => {
    const pluginDir = join(testDir, 'opentabs-plugin-noop');
    mkdirSync(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'opentabs-plugin-noop', version: '0.1.0' }),
      'utf-8',
    );

    const info = await readLocalPluginInfo(pluginDir);

    expect(info?.displayName).toBe('opentabs-plugin-noop');
  });

  test('reads toolCount and toolNames from dist/tools.json', async () => {
    const pluginDir = join(testDir, 'opentabs-plugin-mytools');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'opentabs-plugin-mytools', version: '1.0.0', opentabs: { displayName: 'My Tools' } }),
      'utf-8',
    );
    await writeFile(
      join(pluginDir, 'dist', 'tools.json'),
      JSON.stringify({ tools: [{ name: 'tool_a' }, { name: 'tool_b' }, { name: 'tool_c' }] }),
      'utf-8',
    );

    const info = await readLocalPluginInfo(pluginDir);

    expect(info?.toolCount).toBe(3);
    expect(info?.toolNames).toEqual(['tool_a', 'tool_b', 'tool_c']);
  });

  test('returns null when package.json is missing', async () => {
    const pluginDir = join(testDir, 'nonexistent-plugin');

    const info = await readLocalPluginInfo(pluginDir);

    expect(info).toBeNull();
  });

  test('returns toolCount 0 when dist/tools.json is absent', async () => {
    const pluginDir = join(testDir, 'opentabs-plugin-notools');
    mkdirSync(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'opentabs-plugin-notools', version: '1.0.0', opentabs: { displayName: 'No Tools' } }),
      'utf-8',
    );

    const info = await readLocalPluginInfo(pluginDir);

    expect(info?.toolCount).toBe(0);
    expect(info?.toolNames).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scanNpmPlugins
// ---------------------------------------------------------------------------

describe('scanNpmPlugins', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'opentabs-scannpm-test-'));
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('returns display name from package.json for npm-installed plugin', async () => {
    const pkgName = 'opentabs-plugin-slack';
    const pluginDir = join(testDir, pkgName);
    mkdirSync(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: pkgName, version: '2.0.0', opentabs: { displayName: 'Slack' } }),
      'utf-8',
    );

    const npmListOutput = JSON.stringify({ dependencies: { [pkgName]: { version: '2.0.0' } } });
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(0, npmListOutput) as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(0, `${testDir}\n`) as ReturnType<typeof spawn>);

    const entries = await scanNpmPlugins();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.displayName).toBe('Slack');
    expect(entries[0]?.name).toBe(pkgName);
    expect(entries[0]?.version).toBe('2.0.0');
  });

  test('returns correct toolCount from dist/tools.json for npm-installed plugin', async () => {
    const pkgName = 'opentabs-plugin-mytools';
    const pluginDir = join(testDir, pkgName);
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: pkgName, version: '1.0.0', opentabs: { displayName: 'My Tools' } }),
      'utf-8',
    );
    await writeFile(
      join(pluginDir, 'dist', 'tools.json'),
      JSON.stringify({ tools: [{ name: 'tool_a' }, { name: 'tool_b' }] }),
      'utf-8',
    );

    const npmListOutput = JSON.stringify({ dependencies: { [pkgName]: { version: '1.0.0' } } });
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(0, npmListOutput) as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(0, `${testDir}\n`) as ReturnType<typeof spawn>);

    const entries = await scanNpmPlugins();

    expect(entries[0]?.toolCount).toBe(2);
    expect(entries[0]?.toolNames).toEqual(['tool_a', 'tool_b']);
  });

  test('falls back to raw pkg name as displayName when plugin dir has no package.json', async () => {
    const pkgName = 'opentabs-plugin-missing';

    const npmListOutput = JSON.stringify({ dependencies: { [pkgName]: { version: '0.1.0' } } });
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(0, npmListOutput) as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(0, `${testDir}\n`) as ReturnType<typeof spawn>);

    const entries = await scanNpmPlugins();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.displayName).toBe(pkgName);
    expect(entries[0]?.toolCount).toBe(0);
  });

  test('falls back to toolCount 0 when dist/tools.json is absent', async () => {
    const pkgName = 'opentabs-plugin-notools';
    const pluginDir = join(testDir, pkgName);
    mkdirSync(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: pkgName, version: '1.0.0', opentabs: { displayName: 'No Tools Plugin' } }),
      'utf-8',
    );

    const npmListOutput = JSON.stringify({ dependencies: { [pkgName]: { version: '1.0.0' } } });
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(0, npmListOutput) as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(0, `${testDir}\n`) as ReturnType<typeof spawn>);

    const entries = await scanNpmPlugins();

    expect(entries[0]?.toolCount).toBe(0);
    expect(entries[0]?.displayName).toBe('No Tools Plugin');
  });

  test('handles scoped package name when building plugin directory path', async () => {
    const pkgName = '@opentabs-dev/opentabs-plugin-slack';
    const pluginDir = join(testDir, pkgName);
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: pkgName, version: '3.0.0', opentabs: { displayName: 'Slack' } }),
      'utf-8',
    );
    await writeFile(
      join(pluginDir, 'dist', 'tools.json'),
      JSON.stringify({ tools: Array.from({ length: 22 }, (_, i) => ({ name: `tool_${i.toString()}` })) }),
      'utf-8',
    );

    const npmListOutput = JSON.stringify({ dependencies: { [pkgName]: { version: '3.0.0' } } });
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(0, npmListOutput) as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(0, `${testDir}\n`) as ReturnType<typeof spawn>);

    const entries = await scanNpmPlugins();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.displayName).toBe('Slack');
    expect(entries[0]?.toolCount).toBe(22);
  });

  test('returns empty array when npm list fails', async () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => createMockChild(1, '') as ReturnType<typeof spawn>)
      .mockImplementationOnce(() => createMockChild(0, `${testDir}\n`) as ReturnType<typeof spawn>);

    const entries = await scanNpmPlugins();

    expect(entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pluginNameFromPackage
// ---------------------------------------------------------------------------

describe('pluginNameFromPackage', () => {
  test('strips opentabs-plugin- prefix from unscoped package', () => {
    expect(pluginNameFromPackage('opentabs-plugin-slack')).toBe('slack');
  });

  test('strips prefix from official scoped package', () => {
    expect(pluginNameFromPackage('@opentabs-dev/opentabs-plugin-slack')).toBe('slack');
  });

  test('includes scope for non-official scoped package', () => {
    expect(pluginNameFromPackage('@myorg/opentabs-plugin-jira')).toBe('myorg-jira');
  });

  test('returns name as-is when no prefix matches', () => {
    expect(pluginNameFromPackage('some-package')).toBe('some-package');
  });
});

// ---------------------------------------------------------------------------
// readPluginConfigSchema
// ---------------------------------------------------------------------------

describe('readPluginConfigSchema', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'opentabs-configschema-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('reads configSchema from dist/tools.json', async () => {
    const pluginDir = join(testDir, 'my-plugin');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    const schema = { instanceUrl: { type: 'url', label: 'Instance URL', required: true } };
    await writeFile(
      join(pluginDir, 'dist', 'tools.json'),
      JSON.stringify({ tools: [], configSchema: schema }),
      'utf-8',
    );

    const result = await readPluginConfigSchema(pluginDir);

    expect(result).toEqual(schema);
  });

  test('returns null when dist/tools.json is missing', async () => {
    const pluginDir = join(testDir, 'missing-plugin');
    mkdirSync(pluginDir, { recursive: true });

    const result = await readPluginConfigSchema(pluginDir);

    expect(result).toBeNull();
  });

  test('returns null when configSchema is absent from tools.json', async () => {
    const pluginDir = join(testDir, 'no-schema');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    await writeFile(join(pluginDir, 'dist', 'tools.json'), JSON.stringify({ tools: [] }), 'utf-8');

    const result = await readPluginConfigSchema(pluginDir);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findPluginDir
// ---------------------------------------------------------------------------

describe('findPluginDir', () => {
  let testDir: string;
  const savedConfigDir = process.env.OPENTABS_CONFIG_DIR;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'opentabs-findplugin-test-'));
    process.env.OPENTABS_CONFIG_DIR = testDir;
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    if (savedConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = savedConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
  });

  test('finds plugin in local plugins by short name', async () => {
    const pluginDir = join(testDir, 'my-plugin');
    mkdirSync(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: 'opentabs-plugin-myapp' }), 'utf-8');
    await writeFile(join(testDir, 'config.json'), JSON.stringify({ localPlugins: [pluginDir] }), 'utf-8');

    const result = await findPluginDir('myapp');

    expect(result).not.toBeNull();
    expect(result?.shortName).toBe('myapp');
    expect(result?.dir).toBe(pluginDir);
  });

  test('finds plugin in global npm by shorthand name', async () => {
    const globalRoot = join(testDir, 'global');
    const pluginDir = join(globalRoot, '@opentabs-dev', 'opentabs-plugin-slack');
    mkdirSync(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: '@opentabs-dev/opentabs-plugin-slack' }),
      'utf-8',
    );
    // No config.json → no local plugins
    await writeFile(join(testDir, 'config.json'), JSON.stringify({}), 'utf-8');

    // Mock npm root -g
    vi.mocked(spawn).mockImplementation(() => createMockChild(0, `${globalRoot}\n`) as ReturnType<typeof spawn>);

    const result = await findPluginDir('slack');

    expect(result).not.toBeNull();
    expect(result?.shortName).toBe('slack');
    expect(result?.packageName).toBe('@opentabs-dev/opentabs-plugin-slack');
  });

  test('returns null when plugin is not found', async () => {
    await writeFile(join(testDir, 'config.json'), JSON.stringify({}), 'utf-8');
    vi.mocked(spawn).mockImplementation(
      () => createMockChild(0, `${join(testDir, 'global')}\n`) as ReturnType<typeof spawn>,
    );

    const result = await findPluginDir('nonexistent');

    expect(result).toBeNull();
  });
});
