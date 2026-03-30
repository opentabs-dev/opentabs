/**
 * File watcher for local plugins.
 *
 * Watches local plugin directories (from config.json plugins array) for changes
 * to dist/tools.json and dist/adapter.iife.js. On change:
 * - IIFE change → re-read, send plugin.update to extension
 * - tools.json change → re-read tools AND IIFE, re-register MCP tools, notify MCP clients.
 *   Both files are re-read on tools.json change because `npm run build` typically produces
 *   both new tools and a new IIFE simultaneously. Re-reading the IIFE here avoids
 *   a brief race where the extension has new tool definitions pointing at old adapter code.
 *
 * Only watches local plugins — not npm-installed packages.
 * File change events are debounced at ~200ms.
 *
 * Hot reload safety:
 *   Watcher handles and debounce timers are stored on ServerState (not module-level
 *   variables) so that stopFileWatching() — called from the NEW module after
 *   hot reload re-evaluates — can always reach and close the PREVIOUS iteration's
 *   FSWatcher instances. Module-level variables reset to empty on each reload,
 *   which would orphan the old handles.
 */

import type { FSWatcher } from 'node:fs';
import { readdirSync, statSync, watch } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManifestTool } from '@opentabs-dev/shared';
import { ADAPTER_FILENAME, ADAPTER_SOURCE_MAP_FILENAME, isOk, TOOLS_FILENAME } from '@opentabs-dev/shared';
import { getConfigDir } from './config.js';
import { extractToolsArray, loadPlugin } from './loader.js';
import { log } from './logger.js';
import { buildRegistry } from './registry.js';
import type { FileWatcherEntry, RegisteredPlugin, ServerState } from './state.js';

/** Polling interval for mtime-based fallback detection (ms) */
const MTIME_POLL_INTERVAL_MS = 30_000;

/** Fast polling interval when fs.watch() fails (e.g., EMFILE from inotify limits) */
const MTIME_FAST_POLL_INTERVAL_MS = 200;

/** Number of polling detections within the window that triggers a stale-watcher warning */
const STALE_WATCHER_THRESHOLD = 3;

/** Time window (ms) for counting polling detections toward a stale-watcher warning */
const STALE_WATCHER_WINDOW_MS = 5 * 60 * 1000;

/** Maximum number of detection timestamps to keep (prevents unbounded growth) */
const MAX_DETECTION_TIMESTAMPS = 20;

/** Debounce interval for localPluginDirs parent directory watchers (ms).
 *  Longer than plugin dist/ watcher debounce (200ms) since directory creation
 *  + plugin build takes time and may produce multiple fs events. */
const PLUGIN_DIR_DEBOUNCE_MS = 1000;

/** Callbacks for file watcher events */
interface FileWatcherCallbacks {
  /** Called when a plugin's manifest changes (tools may have changed) */
  onManifestChanged: (pluginName: string) => void;
  /** Send plugin.update to extension with new IIFE and optional source map */
  onIifeChanged: (pluginName: string, iife: string, sourceMap?: string) => void;
  /** Called when ~/.opentabs/config.json changes on disk */
  onConfigChanged: () => void;
  /** Called when a previously-failed plugin path is successfully loaded */
  onPluginDiscovered: (pluginName: string) => void;
}

/**
 * Read a file with retries and exponential backoff.
 * Handles the case where the file is briefly unavailable during a write.
 */
const readFileWithRetry = async (path: string, maxRetries = 3, initialDelayMs = 100): Promise<string> => {
  let delay = initialDelayMs;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await readFile(path, 'utf-8');
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
  throw new Error('readFileWithRetry: unreachable');
};

/**
 * Check if a file exists.
 */
const fileExists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Get the mtimeMs for a file, or null if the file does not exist or stat fails.
 */
const getFileMtimeMs = (path: string): number | null => {
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat ? stat.mtimeMs : null;
  } catch {
    return null;
  }
};

/**
 * Find the FileWatcherEntry for a given plugin directory.
 */
const findEntry = (state: ServerState, pluginDir: string): FileWatcherEntry | undefined =>
  state.fileWatching.entries.find(e => e.pluginDir === pluginDir);

/**
 * Record the current mtime for a file on a FileWatcherEntry's lastSeenMtimes map.
 * Stores null when the file does not exist so the poll loop can detect creation.
 */
const recordMtime = (entry: FileWatcherEntry, filePath: string): void => {
  entry.lastSeenMtimes.set(filePath, getFileMtimeMs(filePath));
};

/**
 * Record a mtime poll detection and emit a warning if detections exceed the
 * threshold within the rolling window. Keeps the timestamps array bounded.
 */
const recordPollDetection = (state: ServerState): void => {
  const now = Date.now();
  const fw = state.fileWatching;
  fw.mtimePollDetections++;
  fw.mtimePollDetectionTimestamps.push(now);

  // Trim to bounded size
  if (fw.mtimePollDetectionTimestamps.length > MAX_DETECTION_TIMESTAMPS) {
    fw.mtimePollDetectionTimestamps = fw.mtimePollDetectionTimestamps.slice(-MAX_DETECTION_TIMESTAMPS);
  }

  // Count detections within the window
  const windowStart = now - STALE_WATCHER_WINDOW_MS;
  const recentDetections = fw.mtimePollDetectionTimestamps.filter(ts => ts >= windowStart);

  // Emit warning exactly when crossing the threshold (not on every subsequent detection)
  if (recentDetections.length === STALE_WATCHER_THRESHOLD) {
    log.warn(
      `File watchers may be stale — detected ${STALE_WATCHER_THRESHOLD} changes via polling that fs.watch missed. Consider restarting the MCP server.`,
    );
  }
};

/**
 * Extract the adapter hash embedded by the CLI's hash-setter snippet.
 *
 * The `opentabs-plugin build` CLI appends a self-contained hash-setter IIFE to every
 * adapter bundle: `a.__adapterHash="<sha256-of-core-content>";`. The embedded
 * hash is computed from the core IIFE content BEFORE the hash-setter is
 * appended, so it matches what the injected adapter reports at runtime.
 *
 * Computing SHA-256 of the full file (including the hash-setter) produces a
 * different value and causes spurious hash-mismatch errors in the extension.
 * Reading the embedded hash directly is always correct.
 *
 * Returns undefined for old adapters built without the hash-setter.
 */
const extractEmbeddedAdapterHash = (iife: string): string | undefined => {
  const match = iife.match(/\.__adapterHash="([0-9a-f]{64})"/);
  return match?.[1];
};

/**
 * Handle an IIFE file change for a local plugin.
 */
const handleIifeChange = async (
  state: ServerState,
  pluginName: string,
  pluginDir: string,
  callbacks: FileWatcherCallbacks,
): Promise<void> => {
  const iifePath = join(pluginDir, 'dist', ADAPTER_FILENAME);

  if (!(await fileExists(iifePath))) {
    log.warn(`File watcher: IIFE not found at ${iifePath} — skipping`);
    return;
  }

  try {
    const iife = await readFileWithRetry(iifePath);
    const plugin = state.registry.plugins.get(pluginName);
    if (!plugin) {
      log.warn(`File watcher: Plugin "${pluginName}" not found in state — skipping IIFE update`);
      return;
    }

    // Build updated fields for the new plugin object
    const updatedFields: Partial<RegisteredPlugin> = { iife };

    // Use the hash embedded in the IIFE by the CLI's hash-setter snippet. The
    // embedded hash is SHA-256 of the core content (before the hash-setter was
    // appended), which is what the adapter reports at runtime via __adapterHash.
    // Computing SHA-256 of the full file would include the hash-setter and
    // produce a value that never matches the runtime adapter hash.
    const embeddedHash = extractEmbeddedAdapterHash(iife);
    if (embeddedHash) {
      updatedFields.adapterHash = embeddedHash;
    }

    // Read source map if available
    const sourceMapPath = join(pluginDir, 'dist', ADAPTER_SOURCE_MAP_FILENAME);
    let sourceMap: string | undefined;
    try {
      if (await fileExists(sourceMapPath)) {
        sourceMap = await readFileWithRetry(sourceMapPath);
        updatedFields.iifeSourceMap = sourceMap;
      }
    } catch {
      // Source map read failed — proceed without it
    }

    // Atomically swap the registry with the updated plugin
    const updatedPlugin: RegisteredPlugin = { ...plugin, ...updatedFields };
    const allPlugins = Array.from(state.registry.plugins.values()).map(p =>
      p.name === pluginName ? updatedPlugin : p,
    );
    state.registry = buildRegistry(allPlugins, [...state.registry.failures]);

    // Update mtime for polling fallback
    const entry = findEntry(state, pluginDir);
    if (entry) recordMtime(entry, iifePath);

    log.info(`File watcher: IIFE updated for "${pluginName}" — sending plugin.update`);

    callbacks.onIifeChanged(pluginName, iife, sourceMap);
  } catch (err) {
    log.error(`File watcher: Failed to read IIFE for "${pluginName}":`, err);
  }
};

/** Parsed result from a tools.json file */
interface ParsedManifest {
  tools: ManifestTool[];
}

/**
 * Parse a tools.json file contents into tools.
 * Supports both legacy array format and current { tools: [...] } format.
 * Returns null if parsing fails.
 */
const parseToolsJson = (raw: string, filePath: string): ParsedManifest | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.error(`File watcher: Invalid JSON in ${filePath}`);
    return null;
  }

  const toolsArray = extractToolsArray(parsed);
  if (!toolsArray) {
    log.error(`File watcher: ${filePath} is not a valid manifest`);
    return null;
  }

  const tools: ManifestTool[] = [];
  for (const t of toolsArray) {
    if (typeof t !== 'object' || t === null) continue;
    const obj = t as Record<string, unknown>;
    if (typeof obj.name !== 'string' || typeof obj.description !== 'string') continue;
    const displayName = typeof obj.displayName === 'string' ? obj.displayName : obj.name;
    const icon = typeof obj.icon === 'string' ? obj.icon : 'wrench';
    const group = typeof obj.group === 'string' ? obj.group : undefined;
    const inputSchema =
      typeof obj.input_schema === 'object' && obj.input_schema !== null
        ? (obj.input_schema as Record<string, unknown>)
        : ({ type: 'object', properties: {} } as Record<string, unknown>);
    const outputSchema =
      typeof obj.output_schema === 'object' && obj.output_schema !== null
        ? (obj.output_schema as Record<string, unknown>)
        : ({ type: 'object', properties: {} } as Record<string, unknown>);
    tools.push({
      name: obj.name,
      displayName,
      description: obj.description,
      icon,
      ...(group ? { group } : {}),
      input_schema: inputSchema,
      output_schema: outputSchema,
    });
  }

  return { tools };
};

/**
 * Handle a dist/tools.json file change for a local plugin.
 *
 * Also re-reads the IIFE from disk because `npm run build` typically updates
 * both tools.json and IIFE simultaneously. Without this, the tools.json watcher
 * would send a plugin.update with the old IIFE, and the extension would
 * briefly have new tool definitions pointing at stale adapter code until
 * the IIFE watcher fires separately.
 */
const handleToolsJsonChange = async (
  state: ServerState,
  pluginName: string,
  pluginDir: string,
  callbacks: FileWatcherCallbacks,
): Promise<void> => {
  const toolsJsonPath = join(pluginDir, 'dist', TOOLS_FILENAME);

  if (!(await fileExists(toolsJsonPath))) {
    log.warn(`File watcher: ${TOOLS_FILENAME} not found at ${toolsJsonPath} — skipping`);
    return;
  }

  try {
    const raw = await readFileWithRetry(toolsJsonPath);
    const parsed = parseToolsJson(raw, toolsJsonPath);
    if (!parsed) return;
    const { tools } = parsed;

    const plugin = state.registry.plugins.get(pluginName);
    if (!plugin) {
      log.warn(`File watcher: Plugin "${pluginName}" not found in state — skipping ${TOOLS_FILENAME} update`);
      return;
    }

    // Build updated fields for the new plugin object
    const updatedFields: Partial<RegisteredPlugin> = { tools };

    // Re-read IIFE from disk so the extension has the latest adapter code.
    // Use the hash embedded in the IIFE rather than recomputing from the full
    // file. The full file includes the hash-setter snippet, so SHA-256(full
    // file) differs from SHA-256(core content) = the value the runtime adapter
    // reports. The embedded hash is always authoritative.
    const iifePath = join(pluginDir, 'dist', ADAPTER_FILENAME);
    if (await fileExists(iifePath)) {
      try {
        const iife = await readFileWithRetry(iifePath);
        updatedFields.iife = iife;
        const embeddedHash = extractEmbeddedAdapterHash(iife);
        if (embeddedHash) {
          updatedFields.adapterHash = embeddedHash;
        }
      } catch {
        // IIFE read failed — the IIFE watcher will handle it separately
      }

      // Read source map if available
      const sourceMapPath = join(pluginDir, 'dist', ADAPTER_SOURCE_MAP_FILENAME);
      try {
        if (await fileExists(sourceMapPath)) {
          updatedFields.iifeSourceMap = await readFileWithRetry(sourceMapPath);
        }
      } catch {
        // Source map read failed — proceed without it
      }
    }

    // Atomically swap the registry with the updated plugin
    const updatedPlugin: RegisteredPlugin = { ...plugin, ...updatedFields };
    const allPlugins = Array.from(state.registry.plugins.values()).map(p =>
      p.name === pluginName ? updatedPlugin : p,
    );
    state.registry = buildRegistry(allPlugins, [...state.registry.failures]);

    // Update mtimes for polling fallback (both tools.json and IIFE were re-read)
    const entry = findEntry(state, pluginDir);
    if (entry) {
      recordMtime(entry, toolsJsonPath);
      recordMtime(entry, iifePath);
    }

    log.info(`File watcher: ${TOOLS_FILENAME} updated for "${pluginName}" — re-registering MCP tools`);

    callbacks.onManifestChanged(pluginName);
  } catch (err) {
    log.error(`File watcher: Failed to read ${TOOLS_FILENAME} for "${pluginName}":`, err);
  }
};

/**
 * Handle a file change in a pending plugin directory (one that failed initial
 * discovery). Attempts full discovery via loadPlugin; on success, adds
 * the plugin to state and invokes onPluginDiscovered so MCP tools are
 * re-registered and the extension is synced.
 */
const handlePendingPluginChange = async (
  state: ServerState,
  pluginDir: string,
  callbacks: FileWatcherCallbacks,
): Promise<void> => {
  const result = await loadPlugin(pluginDir, 'local');
  if (!isOk(result)) return; // Discovery still failing — keep watching silently

  const plugin = result.value;

  // Plugin loaded successfully — add to registry
  if (state.registry.plugins.has(plugin.name)) {
    log.warn(`File watcher: Pending plugin "${plugin.name}" at ${pluginDir} conflicts with existing plugin — skipping`);
    return;
  }

  // Build a new registry that includes the newly discovered plugin.
  // Filter out the failure entry for this path since it succeeded.
  const updatedPlugins = [...state.registry.plugins.values(), plugin];
  const updatedFailures = state.registry.failures.filter(f => f.path !== pluginDir);
  state.registry = buildRegistry(updatedPlugins, updatedFailures);

  // Update mtimes for polling fallback
  const entry = findEntry(state, pluginDir);
  if (entry) {
    recordMtime(entry, join(pluginDir, 'dist', TOOLS_FILENAME));
    recordMtime(entry, join(pluginDir, 'dist', ADAPTER_FILENAME));
  }

  log.info(`File watcher: Discovered pending plugin "${plugin.name}" at ${pluginDir}`);

  callbacks.onPluginDiscovered(plugin.name);
};

/**
 * Set up file watching for a pending plugin directory (one that failed initial
 * discovery). Watches for tools.json and IIFE changes in dist/, and attempts
 * full discovery on each change.
 */
const watchPendingPlugin = (
  state: ServerState,
  pluginDir: string,
  callbacks: FileWatcherCallbacks,
): FileWatcherEntry => {
  const watchers: FSWatcher[] = [];
  const distDir = join(pluginDir, 'dist');
  const gen = state.fileWatching.generation;

  // Watch dist directory for tools.json and IIFE creation/changes
  try {
    const distWatcher = watch(distDir, (_eventType, filename) => {
      if (filename !== TOOLS_FILENAME && filename !== ADAPTER_FILENAME) return;

      const key = `${pluginDir}:pending`;
      const existing = state.fileWatching.timers.get(key);
      if (existing) clearTimeout(existing);

      state.fileWatching.timers.set(
        key,
        setTimeout(() => {
          state.fileWatching.timers.delete(key);
          if (state.fileWatching.generation !== gen) return;
          void handlePendingPluginChange(state, pluginDir, callbacks);
        }, 200),
      );
    });
    distWatcher.on('error', err => {
      log.warn(
        `File watcher: Error on dist watcher for "${pluginDir}": ${err instanceof Error ? err.message : String(err)}`,
      );
      distWatcher.close();
    });
    watchers.push(distWatcher);
  } catch {
    // dist/ may not exist yet — will be watched once plugin is rebuilt
  }

  return { pluginDir, pluginName: `(pending:${pluginDir})`, watchers, lastSeenMtimes: new Map() };
};

/**
 * Set up file watching for a single local plugin directory.
 *
 * Watches the dist/ subdirectory for tools.json and adapter.iife.js changes.
 * Uses directory-level watching (not file-level) because on macOS, file-level
 * fs.watch() via kqueue fails to deliver events after a close + recreate cycle
 * (which happens on every hot reload). Directory-level watching uses FSEvents
 * on macOS and reliably delivers events across watcher restarts.
 */
const watchPlugin = (
  state: ServerState,
  pluginDir: string,
  pluginName: string,
  callbacks: FileWatcherCallbacks,
): FileWatcherEntry => {
  const watchers: FSWatcher[] = [];
  const distDir = join(pluginDir, 'dist');
  const gen = state.fileWatching.generation;

  // Watch dist directory for tools.json and IIFE changes
  try {
    const distWatcher = watch(distDir, (_eventType, filename) => {
      if (filename === TOOLS_FILENAME) {
        const key = `${pluginDir}:tools`;
        const existing = state.fileWatching.timers.get(key);
        if (existing) clearTimeout(existing);

        state.fileWatching.timers.set(
          key,
          setTimeout(() => {
            state.fileWatching.timers.delete(key);
            if (state.fileWatching.generation !== gen) return;
            void handleToolsJsonChange(state, pluginName, pluginDir, callbacks);
          }, 200),
        );
      } else if (filename === ADAPTER_FILENAME) {
        const key = `${pluginDir}:iife`;
        const existing = state.fileWatching.timers.get(key);
        if (existing) clearTimeout(existing);

        state.fileWatching.timers.set(
          key,
          setTimeout(() => {
            state.fileWatching.timers.delete(key);
            if (state.fileWatching.generation !== gen) return;
            void handleIifeChange(state, pluginName, pluginDir, callbacks);
          }, 200),
        );
      }
    });
    distWatcher.on('error', err => {
      log.warn(
        `File watcher: Error on dist watcher for "${pluginName}": ${err instanceof Error ? err.message : String(err)}`,
      );
      distWatcher.close();
    });
    watchers.push(distWatcher);
  } catch (err) {
    log.warn(`File watcher: Could not watch dist dir at ${distDir}:`, err);
  }

  return { pluginDir, pluginName, watchers, lastSeenMtimes: new Map() };
};

/**
 * Get the set of immediate child directory names in a parent directory.
 * Returns an empty set if the directory does not exist or cannot be read.
 */
const getChildDirNames = (parentDir: string): Set<string> => {
  try {
    const entries = readdirSync(parentDir, { withFileTypes: true });
    return new Set(entries.filter(e => e.isDirectory()).map(e => e.name));
  } catch {
    return new Set();
  }
};

/**
 * Start watching localPluginDirs parent directories for new/removed plugin
 * subdirectories. When the set of immediate child directories changes,
 * triggers a config reload to re-run plugin discovery.
 *
 * Each directory gets its own fs.watch() watcher with a debounce that
 * compares the current directory listing to a snapshot taken at watcher
 * start. Only fires onConfigChanged when the child directory set actually
 * changes (not when files inside existing children change).
 *
 * Watchers are stored on FileWatchingState.pluginDirWatchers for cleanup.
 */
const startPluginDirWatching = (state: ServerState, resolvedDirs: string[], callbacks: FileWatcherCallbacks): void => {
  const fw = state.fileWatching;
  const gen = fw.generation;

  for (const dir of resolvedDirs) {
    // Skip non-existent directories
    try {
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        log.warn(`Plugin dir watcher: ${dir} is not a directory — skipping`);
        continue;
      }
    } catch {
      log.warn(`Plugin dir watcher: Cannot access ${dir} — skipping`);
      continue;
    }

    // Snapshot the current child directories at watcher start
    let knownChildren = getChildDirNames(dir);

    try {
      const watcher = watch(dir, (_eventType, _filename) => {
        const key = `pluginDir:${dir}`;
        const existing = fw.timers.get(key);
        if (existing) clearTimeout(existing);

        fw.timers.set(
          key,
          setTimeout(() => {
            fw.timers.delete(key);
            if (state.fileWatching.generation !== gen) return;

            // Compare current children with the snapshot
            const currentChildren = getChildDirNames(dir);
            const added = [...currentChildren].filter(c => !knownChildren.has(c));
            const removed = [...knownChildren].filter(c => !currentChildren.has(c));

            if (added.length === 0 && removed.length === 0) return;

            knownChildren = currentChildren;
            log.info(
              `Plugin dir watcher: ${dir} children changed` +
                (added.length > 0 ? ` (added: ${added.join(', ')})` : '') +
                (removed.length > 0 ? ` (removed: ${removed.join(', ')})` : '') +
                ' — triggering reload',
            );
            callbacks.onConfigChanged();
          }, PLUGIN_DIR_DEBOUNCE_MS),
        );
      });
      watcher.on('error', err => {
        log.warn(`Plugin dir watcher: Error on ${dir}: ${err instanceof Error ? err.message : String(err)}`);
        watcher.close();
      });
      fw.pluginDirWatchers.push(watcher);
      log.info(`Plugin dir watcher: Watching ${dir} for new plugin subdirectories`);
    } catch (err) {
      log.warn(`Plugin dir watcher: Could not watch ${dir}:`, err);
    }
  }
};

/**
 * Start watching the config directory for changes to config.json.
 * Uses directory-level watching (not file-level) because on macOS, file-level
 * fs.watch() via kqueue fails to deliver events after a close + recreate cycle.
 * The debounce pattern matches plugin file watchers — uses fileWatcherTimers
 * with a 'config' key and checks fileWatcherGeneration to discard stale callbacks.
 */
const startConfigWatching = (state: ServerState, callbacks: FileWatcherCallbacks): void => {
  const fw = state.fileWatching;

  // Close any existing config watcher
  if (fw.configWatcher) {
    fw.configWatcher.close();
    fw.configWatcher = null;
  }

  const configDir = getConfigDir();
  const gen = fw.generation;

  // Record initial config.json mtime for mtime polling fallback
  const configPath = join(configDir, 'config.json');
  fw.configLastSeenMtime = getFileMtimeMs(configPath);

  try {
    const configWatcher = watch(configDir, (_eventType: string, filename: string | null) => {
      if (filename !== 'config.json') return;

      const key = 'config';
      const existing = fw.timers.get(key);
      if (existing) clearTimeout(existing);

      fw.timers.set(
        key,
        setTimeout(() => {
          fw.timers.delete(key);
          if (state.fileWatching.generation !== gen) return;
          log.info('Config watcher: config.json changed — triggering reload');
          // Update config mtime for polling fallback
          state.fileWatching.configLastSeenMtime = getFileMtimeMs(configPath);
          callbacks.onConfigChanged();
        }, 200),
      );
    });
    configWatcher.on('error', err => {
      log.warn(
        `File watcher: Error on config watcher for "config": ${err instanceof Error ? err.message : String(err)}`,
      );
      configWatcher.close();
      fw.configWatcher = null;
    });
    fw.configWatcher = configWatcher;

    log.info(`Config watcher: Watching ${configDir} for config.json changes`);
  } catch (err) {
    log.warn(`Config watcher: Could not watch config dir at ${configDir}:`, err);
    log.info(`Config watcher: Watching ${configDir} via mtime polling fallback`);

    // fs.watch() failed (e.g., EMFILE from inotify limits). If mtime polling is
    // running at the default slow interval, restart it at the fast interval so
    // config.json changes are still detected promptly.
    if (fw.mtimePollTimerId !== null) {
      clearInterval(fw.mtimePollTimerId);
      fw.mtimePollTimerId = null;
      startMtimePolling(state, callbacks, MTIME_FAST_POLL_INTERVAL_MS);
    }
  }
};

/**
 * Start periodic mtime polling as a fallback for stale fs.watch() watchers.
 *
 * fs.watch() can go stale on macOS (FSEvents bug in long-running processes)
 * and Linux (inotify limits). This polling loop stats every watched file and
 * config.json on a fixed interval. If a file's mtime is newer than what was
 * last recorded, the appropriate handler is invoked — the same handler that
 * fs.watch() would have called. Because handlers already debounce and check
 * fileWatcherGeneration, duplicate invocations from both fs.watch() and
 * polling are safely deduplicated.
 */
const startMtimePolling = (state: ServerState, callbacks: FileWatcherCallbacks, intervalMs?: number): void => {
  const fw = state.fileWatching;

  // Clean up any existing poll timer (defensive — stopFileWatching should clear this)
  if (fw.mtimePollTimerId !== null) {
    clearInterval(fw.mtimePollTimerId);
    fw.mtimePollTimerId = null;
  }

  const gen = fw.generation;
  const pollInterval = intervalMs ?? MTIME_POLL_INTERVAL_MS;

  fw.mtimePollTimerId = setInterval(() => {
    // Bail out if a new generation started (hot reload happened)
    if (state.fileWatching.generation !== gen) {
      if (state.fileWatching.mtimePollTimerId !== null) {
        clearInterval(state.fileWatching.mtimePollTimerId);
        state.fileWatching.mtimePollTimerId = null;
      }
      return;
    }

    state.fileWatching.mtimeLastPollAt = Date.now();

    // Poll plugin files (tools.json + IIFE)
    for (const entry of state.fileWatching.entries) {
      const toolsJsonPath = join(entry.pluginDir, 'dist', TOOLS_FILENAME);
      const iifePath = join(entry.pluginDir, 'dist', ADAPTER_FILENAME);

      const isPending = entry.pluginName.startsWith('(pending:');

      // Check tools.json mtime
      const toolsMtime = getFileMtimeMs(toolsJsonPath);
      const lastToolsMtime = entry.lastSeenMtimes.get(toolsJsonPath);
      if (
        toolsMtime !== null &&
        lastToolsMtime !== undefined &&
        (lastToolsMtime === null || toolsMtime > lastToolsMtime)
      ) {
        log.info(
          `Mtime poll: Detected change to ${toolsJsonPath} (old=${lastToolsMtime ?? 'none'}, new=${toolsMtime}) — fs.watch may be stale`,
        );
        recordPollDetection(state);
        entry.lastSeenMtimes.set(toolsJsonPath, toolsMtime);
        if (isPending) {
          void handlePendingPluginChange(state, entry.pluginDir, callbacks);
        } else {
          void handleToolsJsonChange(state, entry.pluginName, entry.pluginDir, callbacks);
        }
      }

      // Check IIFE mtime
      const iifeMtime = getFileMtimeMs(iifePath);
      const lastIifeMtime = entry.lastSeenMtimes.get(iifePath);
      if (iifeMtime !== null && lastIifeMtime !== undefined && (lastIifeMtime === null || iifeMtime > lastIifeMtime)) {
        log.info(
          `Mtime poll: Detected change to ${iifePath} (old=${lastIifeMtime ?? 'none'}, new=${iifeMtime}) — fs.watch may be stale`,
        );
        recordPollDetection(state);
        entry.lastSeenMtimes.set(iifePath, iifeMtime);
        if (isPending) {
          void handlePendingPluginChange(state, entry.pluginDir, callbacks);
        } else {
          void handleIifeChange(state, entry.pluginName, entry.pluginDir, callbacks);
        }
      }
    }

    // Poll config.json mtime
    const configPath = join(getConfigDir(), 'config.json');
    const configMtime = getFileMtimeMs(configPath);
    if (
      configMtime !== null &&
      state.fileWatching.configLastSeenMtime !== null &&
      configMtime > state.fileWatching.configLastSeenMtime
    ) {
      log.info(
        `Mtime poll: Detected change to ${configPath} (old=${state.fileWatching.configLastSeenMtime}, new=${configMtime}) — fs.watch may be stale`,
      );
      recordPollDetection(state);
      state.fileWatching.configLastSeenMtime = configMtime;
      callbacks.onConfigChanged();
    }
  }, pollInterval);

  log.info(`Mtime polling started (interval=${pollInterval}ms)`);
};

/**
 * Start file watching for all local plugins and pending plugin paths.
 *
 * Watches two categories:
 * 1. Successfully loaded local plugins (from state.plugins) — watches for
 *    manifest and IIFE updates using the existing per-event handlers.
 * 2. Pending plugin paths (configured in config.json but failed initial
 *    discovery) — watches for any file changes and reattempts full discovery
 *    via loadPluginFromDir.
 *
 * @param resolvedPluginPaths - Absolute paths to all configured local plugin
 *   directories (from config.json, resolved against the config dir). Paths
 *   that exist on disk but are not in state.plugins are watched as pending.
 */
const startFileWatching = (
  state: ServerState,
  callbacks: FileWatcherCallbacks,
  resolvedPluginPaths: string[] = [],
): void => {
  // Clean up any existing watchers first
  stopFileWatching(state);
  state.fileWatching.generation++;

  // Build set of paths already successfully loaded
  const loadedPaths = new Set<string>();

  // Watch successfully loaded local plugins
  const localPlugins = Array.from(state.registry.plugins.values()).filter(p => p.source === 'local' && p.sourcePath);
  for (const plugin of localPlugins) {
    const srcPath = plugin.sourcePath;
    if (!srcPath) continue;
    loadedPaths.add(srcPath);
    const entry = watchPlugin(state, srcPath, plugin.name, callbacks);
    state.fileWatching.entries.push(entry);

    // Record initial mtimes for mtime polling fallback
    recordMtime(entry, join(srcPath, 'dist', TOOLS_FILENAME));
    recordMtime(entry, join(srcPath, 'dist', ADAPTER_FILENAME));

    log.info(`File watcher: Watching "${plugin.name}" at ${srcPath}`);
  }

  // Watch pending plugin paths that failed initial discovery
  let pendingCount = 0;
  for (const pluginPath of resolvedPluginPaths) {
    if (loadedPaths.has(pluginPath)) continue;

    // Skip paths that don't exist on disk
    try {
      if (!statSync(pluginPath, { throwIfNoEntry: false })?.isDirectory()) continue;
    } catch {
      continue;
    }

    const entry = watchPendingPlugin(state, pluginPath, callbacks);
    state.fileWatching.entries.push(entry);

    // Record initial mtimes for mtime polling fallback
    recordMtime(entry, join(pluginPath, 'dist', TOOLS_FILENAME));
    recordMtime(entry, join(pluginPath, 'dist', ADAPTER_FILENAME));

    pendingCount++;

    log.info(`File watcher: Watching pending plugin path at ${pluginPath}`);
  }

  const loadedCount = state.fileWatching.entries.length - pendingCount;
  if (loadedCount === 0 && pendingCount === 0) {
    log.info('File watcher: No local plugins to watch');
  } else {
    log.info(`File watcher: Watching ${loadedCount} loaded + ${pendingCount} pending plugin path(s)`);
  }

  // If any fs.watch() call failed (e.g., EMFILE from inotify instance limits), use
  // fast mtime polling so file changes are still detected promptly.
  const anyWatcherFailed = state.fileWatching.entries.some(e => e.watchers.length === 0);
  const pollInterval = anyWatcherFailed ? MTIME_FAST_POLL_INTERVAL_MS : undefined;

  // Start mtime polling as a fallback for stale fs.watch() watchers
  startMtimePolling(state, callbacks, pollInterval);
};

/**
 * Stop all file watchers and clean up.
 * Reads watcher handles and timers from state (not module-level variables)
 * so that the new module after hot reload can close the old module's watchers.
 */
const stopFileWatching = (state: ServerState): void => {
  const fw = state.fileWatching;

  for (const entry of fw.entries) {
    for (const watcher of entry.watchers) {
      watcher.close();
    }
  }
  fw.entries.length = 0;

  // Close plugin dir watchers
  for (const watcher of fw.pluginDirWatchers) {
    watcher.close();
  }
  fw.pluginDirWatchers.length = 0;

  // Close config watcher
  if (fw.configWatcher) {
    fw.configWatcher.close();
    fw.configWatcher = null;
  }

  // Stop mtime polling
  if (fw.mtimePollTimerId !== null) {
    clearInterval(fw.mtimePollTimerId);
    fw.mtimePollTimerId = null;
  }

  for (const timer of fw.timers.values()) {
    clearTimeout(timer);
  }
  fw.timers.clear();
};

export type { FileWatcherCallbacks };
export { handleToolsJsonChange, startConfigWatching, startFileWatching, startPluginDirWatching, stopFileWatching };
