import { mkdtempSync, rmSync } from 'node:fs';
import * as nodeFsPromises from 'node:fs/promises';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  cleanupStaleAdapterFiles,
  cleanupStaleExecFiles,
  EXEC_FILE_PREFIX,
  ensureAdaptersDir,
  writeAdapterFile,
  writeExecFile,
} from './adapter-files.js';
import { getAdaptersDir } from './config.js';
import { createState } from './state.js';

// ─── Unlink spy for atomicity test ──────────────────────────────────────────
// vi.hoisted ensures both values exist before the vi.mock factory runs, avoiding
// TDZ errors from plain `let` declarations used inside a hoisted factory.

const { mockUnlink, unlinkCapture } = vi.hoisted(() => ({
  mockUnlink: vi.fn<typeof nodeFsPromises.unlink>(),
  unlinkCapture: { realFn: null as null | typeof nodeFsPromises.unlink },
}));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof nodeFsPromises>();
  unlinkCapture.realFn = actual.unlink;
  return { ...actual, unlink: mockUnlink };
});

// Reset to real call-through before each test so existing tests are unaffected.
beforeEach(() => {
  mockUnlink.mockReset();
  // unlinkCapture.realFn is populated by vi.mock factory before any test runs
  mockUnlink.mockImplementation(path => {
    const fn = unlinkCapture.realFn;
    if (!fn) throw new Error('unlinkCapture.realFn not initialized');
    return fn(path);
  });
});

// Override OPENTABS_CONFIG_DIR for test isolation.
const TEST_BASE_DIR = mkdtempSync(join(tmpdir(), 'opentabs-adapter-files-test-'));
const originalConfigDir = process.env.OPENTABS_CONFIG_DIR;
process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;

afterAll(() => {
  if (originalConfigDir !== undefined) {
    process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.OPENTABS_CONFIG_DIR;
  }
  rmSync(TEST_BASE_DIR, { recursive: true, force: true });
});

// ─── writeExecFile ───────────────────────────────────────────────────────────

describe('writeExecFile', () => {
  beforeEach(async () => {
    // Reset adaptersDirReady so ensureAdaptersDir creates the directory
    const state = createState();
    await ensureAdaptersDir(state);
  });

  test('emits an expression-first wrapper with SyntaxError-only fallback', async () => {
    const state = createState();
    const filename = await writeExecFile(state, 'test-1', 'return 42');

    expect(filename).toBe(`${EXEC_FILE_PREFIX}test-1.js`);

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    // Outer IIFE structure is intact
    expect(content.startsWith('(function() {')).toBe(true);
    expect(content.endsWith('})();')).toBe(true);
    // User code is stored as a JSON string in __src (not placed inline)
    expect(content).toContain('var __src = ');
    expect(content).toContain('"return 42"');
    // Expression path uses indirect eval (global scope, no wrapper lexicals exposed)
    expect(content).toContain('(0, eval)');
    // Statement fallback uses new Function (to permit top-level `return`)
    expect(content).toContain('new Function(');
    // Fallback is guarded by SyntaxError check only
    expect(content).toContain('e instanceof SyntaxError');
    // Contains the namespaced result capture mechanism
    expect(content).toContain('__execResult_test-1');
    expect(content).toContain('__openTabs');
  });

  test('stores user code JSON-encoded in __src, safely escaping quotes', async () => {
    const state = createState();
    const code = 'return "hello\\nworld"';
    const filename = await writeExecFile(state, 'escape-test', code);

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    // User code is stored as a JSON string in __src — quotes and backslashes are escaped
    expect(content).toContain(`var __src = ${JSON.stringify(code)};`);
    // Expression and fallback paths are present
    expect(content).toContain('(0, eval)');
    expect(content).toContain('new Function(');
  });

  test('handles async code with promise support in wrapper', async () => {
    const state = createState();
    const code = 'return fetch("/api").then(r => r.json())';
    const filename = await writeExecFile(state, 'async-test', code);

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    // asyncKey variable is declared (for cleanup reference) but not set on __ot
    expect(content).toContain('__execAsync_async-test');
    expect(content).not.toContain('__ot[__asyncKey] = true');
    // Uses __run().then(onFulfilled, onRejected) for direct rejection handling
    expect(content).toContain('__run().then(');
    expect(content).toContain('function(v) { __ot[__resultKey] = { value: v }; }');
    expect(content).toContain('function(e) { __ot[__resultKey] = { error:');
  });

  test('injection-like user code is safely contained inside the JSON __src string', async () => {
    const state = createState();
    const code = '});alert(1);//';
    const filename = await writeExecFile(state, 'inline-test', code);

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    // User code is stored JSON-encoded in __src — cannot break out of the string
    expect(content).toContain(`var __src = ${JSON.stringify(code)};`);
    // The outer IIFE wrapper is intact
    expect(content.startsWith('(function() {')).toBe(true);
    expect(content.endsWith('})();')).toBe(true);
    // Expression and fallback paths are present
    expect(content).toContain('(0, eval)');
    expect(content).toContain('new Function(');
  });

  test('__startedKey sentinel is set synchronously before any try block', async () => {
    const state = createState();
    const filename = await writeExecFile(state, 'started-test', '42');

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    // __startedKey must appear before the first 'try {' so the extension poller
    // can distinguish "IIFE hasn't run yet" from "result pending"
    const startedPos = content.indexOf('__ot[__startedKey] = true;');
    const tryPos = content.indexOf('try {');
    expect(startedPos).toBeGreaterThanOrEqual(0);
    expect(tryPos).toBeGreaterThanOrEqual(0);
    expect(startedPos).toBeLessThan(tryPos);
  });

  test('all three namespaced keys are emitted using the execId', async () => {
    const state = createState();
    const execId = 'uuid-abc-123';
    const filename = await writeExecFile(state, execId, 'document.title');

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    expect(content).toContain(`__execResult_${execId}`);
    expect(content).toContain(`__execAsync_${execId}`);
    expect(content).toContain(`__execStarted_${execId}`);
  });

  test('result is stored as { value } on success path', async () => {
    const state = createState();
    const filename = await writeExecFile(state, 'value-shape-test', '42');

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    expect(content).toContain('__ot[__resultKey] = { value: v }');
  });

  test('error is stored as { error: message } on rejection path', async () => {
    const state = createState();
    const filename = await writeExecFile(state, 'error-shape-test', 'throw new Error("oops")');

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    expect(content).toContain('__ot[__resultKey] = { error: e instanceof Error ? e.message : String(e) }');
  });

  test('creates the adapters directory via ensureAdaptersDir if needed', async () => {
    // Use a fresh temp dir where adapters/ doesn't exist
    const freshDir = mkdtempSync(join(tmpdir(), 'opentabs-adapter-fresh-'));
    const prevConfigDir = process.env.OPENTABS_CONFIG_DIR;
    process.env.OPENTABS_CONFIG_DIR = freshDir;

    try {
      const state = createState();
      const filename = await writeExecFile(state, 'dir-test', 'return 1');
      const adaptersDir = getAdaptersDir();
      const entries = await readdir(adaptersDir);
      expect(entries).toContain(filename);
    } finally {
      process.env.OPENTABS_CONFIG_DIR = prevConfigDir;
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  test('error wrapper catches sync exceptions', async () => {
    const state = createState();
    const filename = await writeExecFile(state, 'error-test', 'throw new Error("boom")');

    const content = await readFile(join(getAdaptersDir(), filename), 'utf-8');
    // The wrapper has a try/catch
    expect(content).toContain('} catch (e) {');
    expect(content).toContain('e instanceof Error ? e.message : String(e)');
  });
});

// ─── writeAdapterFile ────────────────────────────────────────────────────────

describe('writeAdapterFile', () => {
  beforeEach(async () => {
    const state = createState();
    await ensureAdaptersDir(state);
  });

  test('writes IIFE content to adapters directory with content-hashed filename', async () => {
    const iife = '(function(){console.log("adapter")})();';
    const adapterFile = await writeAdapterFile('test-plugin', iife);

    // Return value is a relative path with content hash
    expect(adapterFile).toMatch(/^adapters\/test-plugin-[0-9a-f]{8}\.js$/);

    // File is written to the adapters directory using the returned path
    const fileName = adapterFile.replace('adapters/', '');
    const content = await readFile(join(getAdaptersDir(), fileName), 'utf-8');
    expect(content).toBe(iife);
  });

  test('rewrites sourceMappingURL when sourceMap is provided', async () => {
    const iife = '(function(){})();\n//# sourceMappingURL=adapter.iife.js.map';
    const sourceMap = '{"version":3,"mappings":""}';
    const adapterFile = await writeAdapterFile('my-plugin', iife, sourceMap);

    // Extract the hashed base name from the returned path
    const baseName = adapterFile.replace('adapters/', '').replace('.js', '');
    const fileName = adapterFile.replace('adapters/', '');

    const content = await readFile(join(getAdaptersDir(), fileName), 'utf-8');
    expect(content).toContain(`//# sourceMappingURL=${baseName}.js.map`);
    expect(content).not.toContain('adapter.iife.js.map');

    // Source map file is also written with hashed name
    const mapContent = await readFile(join(getAdaptersDir(), `${baseName}.js.map`), 'utf-8');
    expect(mapContent).toBe(sourceMap);
  });

  test('does not rewrite sourceMappingURL when no sourceMap is provided', async () => {
    const iife = '(function(){})();\n//# sourceMappingURL=adapter.iife.js.map';
    const adapterFile = await writeAdapterFile('no-map-plugin', iife);

    const fileName = adapterFile.replace('adapters/', '');
    const content = await readFile(join(getAdaptersDir(), fileName), 'utf-8');
    // sourceMappingURL is left as-is since no source map was provided
    expect(content).toContain('sourceMappingURL=adapter.iife.js.map');
  });

  test('does not delete adapter files for plugins whose names share a prefix', async () => {
    // Writing plugin 'foo' must not delete files for plugin 'foo-bar'
    const adaptersDir = getAdaptersDir();
    const fooBarIife = '(function(){console.log("foo-bar")})();';
    const fooBarPath = await writeAdapterFile('foo-bar', fooBarIife);
    const fooBarFile = fooBarPath.replace('adapters/', '');

    // Now write a new version of plugin 'foo' — should not touch 'foo-bar' files
    const fooIife1 = '(function(){console.log("foo-v1")})();';
    const fooIife2 = '(function(){console.log("foo-v2")})();';
    await writeAdapterFile('foo', fooIife1);
    await writeAdapterFile('foo', fooIife2); // triggers cleanup of 'foo' old files

    const entries = await readdir(adaptersDir);
    expect(entries).toContain(fooBarFile);
  });

  test('cleans up old hashed versions when content changes', async () => {
    const iife1 = '(function(){console.log("v1")})();';
    const iife2 = '(function(){console.log("v2")})();';

    const path1 = await writeAdapterFile('cleanup-test', iife1);
    const entries1 = await readdir(getAdaptersDir());
    const file1 = entries1.find(f => f.startsWith('cleanup-test-') && f.endsWith('.js'));
    expect(file1).toBeDefined();

    const path2 = await writeAdapterFile('cleanup-test', iife2);
    expect(path2).not.toBe(path1); // Different content → different hash

    const entries2 = await readdir(getAdaptersDir());
    const files = entries2.filter(f => f.startsWith('cleanup-test-') && f.endsWith('.js'));
    // Only the new hashed file should remain
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(path2.replace('adapters/', ''));
  });

  test('new adapter file is on disk when old versions are unlinked', async () => {
    const adaptersDir = getAdaptersDir();
    const iife1 = '(function(){console.log("atom-v1")})();';
    const iife2 = '(function(){console.log("atom-v2")})();';

    // Write initial version so there is an old file to clean up
    const path1 = await writeAdapterFile('atom-test', iife1);
    const oldFile = path1.replace('adapters/', '');

    // Capture directory contents when the old adapter file is unlinked.
    // On Windows, atomicWrite also calls unlink internally (to replace the
    // target before rename), so we filter to only capture state when the
    // old adapter file is the one being deleted — not internal atomicWrite calls.
    let entriesAtOldFileUnlink: string[] = [];
    mockUnlink.mockImplementation(async path => {
      const pathStr = typeof path === 'string' ? path : path.toString();
      if (pathStr.endsWith(oldFile) && entriesAtOldFileUnlink.length === 0) {
        entriesAtOldFileUnlink = await nodeFsPromises.readdir(adaptersDir);
      }
      const fn = unlinkCapture.realFn;
      if (!fn) throw new Error('unlinkCapture.realFn not initialized');
      return fn(path);
    });

    const path2 = await writeAdapterFile('atom-test', iife2);
    const newFile = path2.replace('adapters/', '');

    // The new file must already exist on disk when unlink is called for old files,
    // ensuring there is no window where zero adapter files exist for this plugin.
    expect(entriesAtOldFileUnlink).toContain(newFile);
  });
});

// ─── cleanupStaleExecFiles ───────────────────────────────────────────────────

describe('cleanupStaleExecFiles', () => {
  beforeEach(async () => {
    const state = createState();
    await ensureAdaptersDir(state);
  });

  test('removes __exec-*.js files from adapters directory', async () => {
    const adaptersDir = getAdaptersDir();
    await writeFile(join(adaptersDir, `${EXEC_FILE_PREFIX}abc.js`), 'code');
    await writeFile(join(adaptersDir, `${EXEC_FILE_PREFIX}def.js`), 'code');

    await cleanupStaleExecFiles();

    const entries = await readdir(adaptersDir);
    expect(entries.filter(f => f.startsWith(EXEC_FILE_PREFIX))).toEqual([]);
  });

  test('removes __exec-*.js.tmp files from adapters directory', async () => {
    const adaptersDir = getAdaptersDir();
    await writeFile(join(adaptersDir, `${EXEC_FILE_PREFIX}abc.js.tmp`), 'tmp');

    await cleanupStaleExecFiles();

    const entries = await readdir(adaptersDir);
    expect(entries.filter(f => f.startsWith(EXEC_FILE_PREFIX))).toEqual([]);
  });

  test('leaves non-exec files untouched', async () => {
    const adaptersDir = getAdaptersDir();
    await writeFile(join(adaptersDir, 'my-plugin.js'), 'adapter code');
    await writeFile(join(adaptersDir, `${EXEC_FILE_PREFIX}stale.js`), 'exec code');

    await cleanupStaleExecFiles();

    const entries = await readdir(adaptersDir);
    expect(entries).toContain('my-plugin.js');
    expect(entries).not.toContain(`${EXEC_FILE_PREFIX}stale.js`);
  });

  test('handles missing adapters directory gracefully', async () => {
    // Point to a directory that does not exist
    const emptyDir = mkdtempSync(join(tmpdir(), 'opentabs-adapter-empty-'));
    const prevConfigDir = process.env.OPENTABS_CONFIG_DIR;
    process.env.OPENTABS_CONFIG_DIR = emptyDir;

    try {
      // Should not throw
      await cleanupStaleExecFiles();
    } finally {
      process.env.OPENTABS_CONFIG_DIR = prevConfigDir;
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ─── cleanupStaleAdapterFiles ────────────────────────────────────────────────

describe('cleanupStaleAdapterFiles', () => {
  beforeEach(async () => {
    const state = createState();
    await ensureAdaptersDir(state);
  });

  test('removes hashed .js files for plugins not in current set', async () => {
    const adaptersDir = getAdaptersDir();
    await writeFile(join(adaptersDir, 'plugin-a-12345678.js'), 'a');
    await writeFile(join(adaptersDir, 'plugin-b-abcdef01.js'), 'b');

    await cleanupStaleAdapterFiles(new Set(['plugin-a']));

    const entries = await readdir(adaptersDir);
    expect(entries).toContain('plugin-a-12345678.js');
    expect(entries).not.toContain('plugin-b-abcdef01.js');
  });

  test('removes hashed .js.map files for plugins not in current set', async () => {
    const adaptersDir = getAdaptersDir();
    await writeFile(join(adaptersDir, 'plugin-a-12345678.js'), 'a');
    await writeFile(join(adaptersDir, 'plugin-a-12345678.js.map'), 'map-a');
    await writeFile(join(adaptersDir, 'plugin-b-abcdef01.js'), 'b');
    await writeFile(join(adaptersDir, 'plugin-b-abcdef01.js.map'), 'map-b');

    await cleanupStaleAdapterFiles(new Set(['plugin-a']));

    const entries = await readdir(adaptersDir);
    expect(entries).toContain('plugin-a-12345678.js');
    expect(entries).toContain('plugin-a-12345678.js.map');
    expect(entries).not.toContain('plugin-b-abcdef01.js');
    expect(entries).not.toContain('plugin-b-abcdef01.js.map');
  });

  test('keeps current plugins untouched', async () => {
    const adaptersDir = getAdaptersDir();
    await writeFile(join(adaptersDir, 'kept-a-11111111.js'), 'a');
    await writeFile(join(adaptersDir, 'kept-b-22222222.js'), 'b');

    await cleanupStaleAdapterFiles(new Set(['kept-a', 'kept-b']));

    const entries = await readdir(adaptersDir);
    expect(entries).toContain('kept-a-11111111.js');
    expect(entries).toContain('kept-b-22222222.js');
  });

  test('does not remove __exec-* files (managed by cleanupStaleExecFiles)', async () => {
    const adaptersDir = getAdaptersDir();
    await writeFile(join(adaptersDir, `${EXEC_FILE_PREFIX}session.js`), 'exec');

    await cleanupStaleAdapterFiles(new Set());

    const entries = await readdir(adaptersDir);
    expect(entries).toContain(`${EXEC_FILE_PREFIX}session.js`);
  });

  test('does not remove .tmp files', async () => {
    const adaptersDir = getAdaptersDir();
    await writeFile(join(adaptersDir, 'stale.js.tmp'), 'tmp');

    await cleanupStaleAdapterFiles(new Set());

    const entries = await readdir(adaptersDir);
    expect(entries).toContain('stale.js.tmp');
  });

  test('handles missing adapters directory gracefully', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'opentabs-adapter-nodir-'));
    const prevConfigDir = process.env.OPENTABS_CONFIG_DIR;
    process.env.OPENTABS_CONFIG_DIR = emptyDir;

    try {
      await cleanupStaleAdapterFiles(new Set(['any']));
    } finally {
      process.env.OPENTABS_CONFIG_DIR = prevConfigDir;
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
