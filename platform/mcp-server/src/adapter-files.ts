/**
 * Adapter and exec file I/O for the extension's adapters/ directory.
 * Handles writing plugin adapter IIFEs, dynamic exec scripts, and cleanup.
 */

import { getAdaptersDir } from './config.js';
import { log } from './logger.js';
import { atomicWrite } from '@opentabs-dev/shared';
import { createHash } from 'node:crypto';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerState } from './state.js';

/**
 * Ensure the adapters directory exists, creating it if necessary.
 * Caches the result on ServerState so mkdir is called at most once per
 * server lifetime. The flag survives hot reloads (via globalThis state).
 */
const ensureAdaptersDir = async (state: ServerState): Promise<void> => {
  if (state.adaptersDirReady) return;
  await mkdir(getAdaptersDir(), { recursive: true });
  state.adaptersDirReady = true;
};

/** Prefix for dynamically generated exec script files */
const EXEC_FILE_PREFIX = '__exec-';

/** Escape special regex characters in a string for use in a RegExp */
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Timeout for batch adapter file writes in sendSyncFull (10 seconds) */
const ADAPTER_WRITE_TIMEOUT_MS = 10_000;

/** Create a cancellable timeout promise for use with Promise.race */
const timeoutRace = <T>(value: T, ms: number): { promise: Promise<T>; cancel: () => void } => {
  let timerId: ReturnType<typeof setTimeout>;
  const promise = new Promise<T>(resolve => {
    timerId = setTimeout(() => resolve(value), ms);
  });
  // timerId is assigned synchronously by the Promise executor
  const cancel = () => clearTimeout(timerId);
  return { promise, cancel };
};

/**
 * Write a plugin's adapter IIFE to the extension's adapters/ directory.
 * Uses content-hashed filenames ({pluginName}-{hash8}.js) so each version
 * gets a unique path, preventing Chrome's aggressive caching of
 * executeScript({ files }) content.
 *
 * If a source map is provided, writes it alongside the adapter as
 * {pluginName}-{hash8}.js.map and rewrites the sourceMappingURL in the IIFE.
 *
 * Returns the relative path (e.g., "adapters/my-plugin-a1b2c3d4.js") for
 * the extension to fetch and inject.
 */
const writeAdapterFile = async (pluginName: string, iife: string, sourceMap?: string): Promise<string> => {
  const adaptersDir = getAdaptersDir();
  const contentHash = createHash('sha256').update(iife).digest('hex').slice(0, 8);
  const baseName = `${pluginName}-${contentHash}`;

  // Clean up old hashed versions of the same plugin before writing the new one
  let entries: string[];
  try {
    entries = await readdir(adaptersDir);
  } catch {
    entries = [];
  }
  // Match only files for this exact plugin: {pluginName}-{8hexchars}.js or .js.map
  // Using a regex prevents prefix collisions (e.g., plugin 'foo' must not delete
  // files for plugin 'foo-bar').
  const pluginFileRegex = new RegExp(`^${escapeRegex(pluginName)}-[0-9a-f]{8}\\.js(\\.map)?$`);
  const oldFiles = entries.filter(f => pluginFileRegex.test(f) && f !== `${baseName}.js` && f !== `${baseName}.js.map`);
  await Promise.allSettled(oldFiles.map(f => unlink(join(adaptersDir, f))));

  let content = iife;
  if (sourceMap) {
    // Rewrite sourceMappingURL to use the per-plugin hashed filename
    content = iife.replace(/\/\/# sourceMappingURL=adapter\.iife\.js\.map/, `//# sourceMappingURL=${baseName}.js.map`);

    // Write source map atomically
    const mapFinalPath = join(adaptersDir, `${baseName}.js.map`);
    await atomicWrite(mapFinalPath, sourceMap);
  }

  await atomicWrite(join(adaptersDir, `${baseName}.js`), content);
  return `adapters/${baseName}.js`;
};

/**
 * Remove stale adapter .js files from the adapters directory that do not
 * correspond to any plugin in the current set. Called from sendSyncFull
 * before writing new adapter files.
 */
const cleanupStaleAdapterFiles = async (currentPluginNames: Set<string>): Promise<void> => {
  const adaptersDir = getAdaptersDir();
  let entries: string[];
  try {
    entries = await readdir(adaptersDir);
  } catch {
    // Directory may not exist yet on first run
    return;
  }

  // Strip the content hash suffix (-[0-9a-f]{8}) from hashed filenames
  // to recover the plugin name for staleness checks.
  const stripHash = (name: string): string => name.replace(/-[0-9a-f]{8}$/, '');

  const staleFiles = entries.filter(f => {
    if (f.endsWith('.js.tmp') || f.endsWith('.js.map.tmp')) return false;
    if (f.startsWith(EXEC_FILE_PREFIX)) return false; // Managed by cleanupStaleExecFiles

    // Match adapter .js files (hashed: plugin-name-a1b2c3d4.js)
    if (f.endsWith('.js')) {
      const baseName = f.slice(0, -3); // strip '.js'
      const pluginName = stripHash(baseName);
      return !currentPluginNames.has(pluginName);
    }

    // Match adapter .js.map source map files
    if (f.endsWith('.js.map')) {
      const baseName = f.slice(0, -7); // strip '.js.map'
      const pluginName = stripHash(baseName);
      return !currentPluginNames.has(pluginName);
    }

    return false;
  });

  if (staleFiles.length === 0) return;

  const results = await Promise.allSettled(staleFiles.map(f => unlink(join(adaptersDir, f))));
  let deleted = 0;
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const fileName = staleFiles[i] ?? 'unknown';
      log.warn(`Failed to delete stale adapter file ${fileName}:`, result.reason);
    } else {
      deleted++;
    }
  }
  log.info(`Cleaned up ${deleted} stale adapter file(s)`);
};

// ---------------------------------------------------------------------------
// Dynamic exec file helpers — write/delete/cleanup for browser_execute_script
// ---------------------------------------------------------------------------

/**
 * Write a dynamic exec script to the adapters/ directory.
 * Wraps the user's code in an IIFE that captures the result (sync or async)
 * into globalThis.__openTabs.__lastExecResult for the extension to read back.
 *
 * Returns the filename (relative to adapters/) for the extension to inject.
 */
const writeExecFile = async (state: ServerState, execId: string, code: string): Promise<string> => {
  await ensureAdaptersDir(state);
  const filename = `${EXEC_FILE_PREFIX}${execId}.js`;
  const finalPath = join(getAdaptersDir(), filename);

  // Wrap user code to capture sync/async results and errors.
  // The wrapper stores results at globalThis.__openTabs.__lastExecResult.
  // The extension reads this value after injection and cleans it up.
  //
  // User code is passed as a JSON-escaped string literal to new Function(),
  // preventing IIFE wrapper breakout attacks. The Function constructor
  // parses the code in its own context — closing braces/parens in user
  // code cannot break the wrapper syntax.
  const wrapped = [
    '(function() {',
    '  var __ot = globalThis.__openTabs = globalThis.__openTabs || {};',
    '  try {',
    `    var __userFn = new Function(${JSON.stringify(code)});`,
    '    var __r = __userFn();',
    '    if (__r && typeof __r === "object" && typeof __r.then === "function") {',
    '      __ot.__lastExecAsync = true;',
    '      __r.then(function(v) { __ot.__lastExecResult = { value: v }; })',
    '        .catch(function(e) { __ot.__lastExecResult = { error: e instanceof Error ? e.message : String(e) }; });',
    '    } else {',
    '      __ot.__lastExecResult = { value: __r };',
    '    }',
    '  } catch (e) {',
    '    __ot.__lastExecResult = { error: e instanceof Error ? e.message : String(e) };',
    '  }',
    '})();',
  ].join('\n');

  await atomicWrite(finalPath, wrapped);
  return filename;
};

/** Delete a dynamic exec script file. Fire-and-forget — logs on failure. */
const deleteExecFile = async (filename: string): Promise<void> => {
  try {
    await unlink(join(getAdaptersDir(), filename));
  } catch {
    log.warn(`Failed to delete exec file: ${filename}`);
  }
};

/**
 * Remove stale __exec-*.js files from the adapters directory.
 * Called on server startup to clean up leftovers from crashed sessions.
 */
const cleanupStaleExecFiles = async (): Promise<void> => {
  const adaptersDir = getAdaptersDir();
  let entries: string[];
  try {
    entries = await readdir(adaptersDir);
  } catch {
    return;
  }

  const staleExecFiles = entries.filter(
    f => f.startsWith(EXEC_FILE_PREFIX) && (f.endsWith('.js') || f.endsWith('.js.tmp')),
  );
  if (staleExecFiles.length === 0) return;

  const results = await Promise.allSettled(staleExecFiles.map(f => unlink(join(adaptersDir, f))));
  let deleted = 0;
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const fileName = staleExecFiles[i] ?? 'unknown';
      log.warn(`Failed to delete stale exec file ${fileName}:`, result.reason);
    } else {
      deleted++;
    }
  }
  log.info(`Cleaned up ${deleted} stale exec file(s)`);
};

export {
  ensureAdaptersDir,
  writeAdapterFile,
  cleanupStaleAdapterFiles,
  writeExecFile,
  deleteExecFile,
  cleanupStaleExecFiles,
  timeoutRace,
  ADAPTER_WRITE_TIMEOUT_MS,
  EXEC_FILE_PREFIX,
};
