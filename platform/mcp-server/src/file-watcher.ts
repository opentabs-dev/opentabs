/**
 * File watcher for local plugins.
 *
 * Watches local plugin directories (from config.json plugins array) for changes
 * to opentabs-plugin.json and dist/adapter.iife.js. On change:
 * - IIFE change → re-read, send plugin.update to extension
 * - Manifest change → re-read manifest AND IIFE, re-register MCP tools, notify MCP clients.
 *   Both files are re-read on manifest change because `bun run build` typically produces
 *   both a new manifest and a new IIFE simultaneously. Re-reading the IIFE here avoids
 *   a brief race where the extension has new tool definitions pointing at old adapter code.
 *
 * Only watches local plugins — not npm-installed packages.
 * File change events are debounced at ~200ms.
 *
 * Hot reload safety:
 *   Watcher handles and debounce timers are stored on ServerState (not module-level
 *   variables) so that stopFileWatching() — called from the NEW module after
 *   bun --hot re-evaluates — can always reach and close the PREVIOUS iteration's
 *   FSWatcher instances. Module-level variables reset to empty on each reload,
 *   which would orphan the old handles.
 */

import { getConfigDir } from './config.js';
import { loadPluginFromDir } from './discovery-legacy.js';
import { log } from './logger.js';
import { parseManifest } from './manifest-schema.js';
import { validateUrlPattern } from '@opentabs-dev/shared';
import { statSync, watch } from 'node:fs';
import { join } from 'node:path';
import type { ServerState, FileWatcherEntry } from './state.js';
import type { FSWatcher } from 'node:fs';

/** Polling interval for mtime-based fallback detection (ms) */
const MTIME_POLL_INTERVAL_MS = 30_000;

/** Number of polling detections within the window that triggers a stale-watcher warning */
const STALE_WATCHER_THRESHOLD = 3;

/** Time window (ms) for counting polling detections toward a stale-watcher warning */
const STALE_WATCHER_WINDOW_MS = 5 * 60 * 1000;

/** Maximum number of detection timestamps to keep (prevents unbounded growth) */
const MAX_DETECTION_TIMESTAMPS = 20;

/** Callbacks for file watcher events */
interface FileWatcherCallbacks {
  /** Called when a plugin's manifest changes (tools may have changed) */
  onManifestChanged: (pluginName: string) => void;
  /** Send plugin.update to extension with new IIFE */
  onIifeChanged: (pluginName: string, iife: string) => void;
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
      return await Bun.file(path).text();
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
const fileExists = async (path: string): Promise<boolean> => Bun.file(path).exists();

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
  state.fileWatcherEntries.find(e => e.pluginDir === pluginDir);

/**
 * Record the current mtime for a file on a FileWatcherEntry's lastSeenMtimes map.
 */
const recordMtime = (entry: FileWatcherEntry, filePath: string): void => {
  const mtime = getFileMtimeMs(filePath);
  if (mtime !== null) {
    entry.lastSeenMtimes.set(filePath, mtime);
  }
};

/**
 * Record a mtime poll detection and emit a warning if detections exceed the
 * threshold within the rolling window. Keeps the timestamps array bounded.
 */
const recordPollDetection = (state: ServerState): void => {
  const now = Date.now();
  state.mtimePollDetections++;
  state.mtimePollDetectionTimestamps.push(now);

  // Trim to bounded size
  if (state.mtimePollDetectionTimestamps.length > MAX_DETECTION_TIMESTAMPS) {
    state.mtimePollDetectionTimestamps = state.mtimePollDetectionTimestamps.slice(-MAX_DETECTION_TIMESTAMPS);
  }

  // Count detections within the window
  const windowStart = now - STALE_WATCHER_WINDOW_MS;
  const recentDetections = state.mtimePollDetectionTimestamps.filter(ts => ts >= windowStart);

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
 * The `opentabs build` CLI appends a self-contained hash-setter IIFE to every
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
  const iifePath = join(pluginDir, 'dist', 'adapter.iife.js');

  if (!(await fileExists(iifePath))) {
    log.warn(`File watcher: IIFE not found at ${iifePath} — skipping`);
    return;
  }

  try {
    const iife = await readFileWithRetry(iifePath);
    const plugin = state.plugins.get(pluginName);
    if (!plugin) {
      log.warn(`File watcher: Plugin "${pluginName}" not found in state — skipping IIFE update`);
      return;
    }

    // Update in-memory state
    plugin.iife = iife;

    // Use the hash embedded in the IIFE by the CLI's hash-setter snippet. The
    // embedded hash is SHA-256 of the core content (before the hash-setter was
    // appended), which is what the adapter reports at runtime via __adapterHash.
    // Computing SHA-256 of the full file would include the hash-setter and
    // produce a value that never matches the runtime adapter hash.
    const embeddedHash = extractEmbeddedAdapterHash(iife);
    if (embeddedHash) {
      plugin.adapterHash = embeddedHash;
    }

    // Update mtime for polling fallback
    const entry = findEntry(state, pluginDir);
    if (entry) recordMtime(entry, iifePath);

    log.info(`File watcher: IIFE updated for "${pluginName}" — sending plugin.update`);

    callbacks.onIifeChanged(pluginName, iife);
  } catch (err) {
    log.error(`File watcher: Failed to read IIFE for "${pluginName}":`, err);
  }
};

/**
 * Handle a manifest file change for a local plugin.
 *
 * Also re-reads the IIFE from disk because `bun run build` typically updates
 * both manifest and IIFE simultaneously. Without this, the manifest watcher
 * would send a plugin.update with the old IIFE, and the extension would
 * briefly have new tool definitions pointing at stale adapter code until
 * the IIFE watcher fires separately.
 */
const handleManifestChange = async (
  state: ServerState,
  pluginName: string,
  pluginDir: string,
  callbacks: FileWatcherCallbacks,
): Promise<void> => {
  const manifestPath = join(pluginDir, 'opentabs-plugin.json');

  if (!(await fileExists(manifestPath))) {
    log.warn(`File watcher: Manifest not found at ${manifestPath} — skipping`);
    return;
  }

  try {
    const raw = await readFileWithRetry(manifestPath);
    const manifest = parseManifest(raw, manifestPath);

    const manifestBare = manifest.name.replace(/^opentabs-plugin-/, '');
    if (manifestBare !== pluginName) {
      log.warn(
        `File watcher: Manifest name "${manifest.name}" does not match expected plugin "${pluginName}" — skipping`,
      );
      return;
    }

    const plugin = state.plugins.get(pluginName);
    if (!plugin) {
      log.warn(`File watcher: Plugin "${pluginName}" not found in state — skipping manifest update`);
      return;
    }

    // Validate URL patterns, filtering out any invalid ones
    const validPatterns = manifest.url_patterns.filter(p => {
      const error = validateUrlPattern(p);
      if (error) {
        log.warn(`File watcher: Plugin "${pluginName}" has invalid URL pattern "${p}": ${error}`);
        return false;
      }
      return true;
    });
    if (validPatterns.length === 0) {
      log.warn(`File watcher: Plugin "${pluginName}" has no valid URL patterns — skipping update`);
      return;
    }

    // Update plugin metadata
    plugin.version = manifest.version;
    plugin.displayName = manifest.displayName;
    plugin.urlPatterns = validPatterns;
    plugin.adapterHash = manifest.adapterHash;
    plugin.tools = manifest.tools.map(t => ({
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      icon: t.icon,
      input_schema: t.input_schema,
      output_schema: t.output_schema,
    }));

    // Re-read IIFE from disk so the extension has the latest adapter code.
    // Use the hash embedded in the IIFE rather than recomputing from the full
    // file. The full file includes the hash-setter snippet, so SHA-256(full
    // file) differs from SHA-256(core content) = the value the runtime adapter
    // reports. The embedded hash is always authoritative.
    const iifePath = join(pluginDir, 'dist', 'adapter.iife.js');
    if (await fileExists(iifePath)) {
      try {
        const iife = await readFileWithRetry(iifePath);
        plugin.iife = iife;
        const embeddedHash = extractEmbeddedAdapterHash(iife);
        if (embeddedHash) {
          plugin.adapterHash = embeddedHash;
        }
      } catch {
        // IIFE read failed — the IIFE watcher will handle it separately
      }
    }

    // Update mtimes for polling fallback (both manifest and IIFE were re-read)
    const entry = findEntry(state, pluginDir);
    if (entry) {
      recordMtime(entry, manifestPath);
      recordMtime(entry, iifePath);
    }

    log.info(`File watcher: Manifest updated for "${pluginName}" — re-registering MCP tools`);

    callbacks.onManifestChanged(pluginName);
  } catch (err) {
    log.error(`File watcher: Failed to read manifest for "${pluginName}":`, err);
  }
};

/**
 * Handle a file change in a pending plugin directory (one that failed initial
 * discovery). Attempts full discovery via loadPluginFromDir; on success, adds
 * the plugin to state and invokes onPluginDiscovered so MCP tools are
 * re-registered and the extension is synced.
 */
const handlePendingPluginChange = async (
  state: ServerState,
  pluginDir: string,
  callbacks: FileWatcherCallbacks,
): Promise<void> => {
  try {
    const plugin = await loadPluginFromDir(pluginDir, 'local', null, pluginDir);

    // Plugin loaded successfully — add to state
    if (state.plugins.has(plugin.name)) {
      log.warn(
        `File watcher: Pending plugin "${plugin.name}" at ${pluginDir} conflicts with existing plugin — skipping`,
      );
      return;
    }

    state.plugins.set(plugin.name, plugin);

    // Update mtimes for polling fallback
    const entry = findEntry(state, pluginDir);
    if (entry) {
      recordMtime(entry, join(pluginDir, 'opentabs-plugin.json'));
      recordMtime(entry, join(pluginDir, 'dist', 'adapter.iife.js'));
    }

    log.info(`File watcher: Discovered pending plugin "${plugin.name}" at ${pluginDir}`);

    callbacks.onPluginDiscovered(plugin.name);
  } catch {
    // Discovery still failing — keep watching silently
  }
};

/**
 * Set up file watching for a pending plugin directory (one that failed initial
 * discovery). Watches for manifest and IIFE changes, and attempts full
 * discovery on each change.
 */
const watchPendingPlugin = (
  state: ServerState,
  pluginDir: string,
  callbacks: FileWatcherCallbacks,
): FileWatcherEntry => {
  const watchers: FSWatcher[] = [];
  const distDir = join(pluginDir, 'dist');
  const gen = state.fileWatcherGeneration;

  // Watch plugin directory for manifest creation/changes
  try {
    const manifestWatcher = watch(pluginDir, (_eventType, filename) => {
      if (filename !== 'opentabs-plugin.json') return;

      const key = `${pluginDir}:pending`;
      const existing = state.fileWatcherTimers.get(key);
      if (existing) clearTimeout(existing);

      state.fileWatcherTimers.set(
        key,
        setTimeout(() => {
          state.fileWatcherTimers.delete(key);
          if (state.fileWatcherGeneration !== gen) return;
          void handlePendingPluginChange(state, pluginDir, callbacks);
        }, 200),
      );
    });
    watchers.push(manifestWatcher);
  } catch (err) {
    log.warn(`File watcher: Could not watch pending plugin dir at ${pluginDir}:`, err);
  }

  // Watch dist directory for IIFE creation/changes
  try {
    const distWatcher = watch(distDir, (_eventType, filename) => {
      if (filename !== 'adapter.iife.js') return;

      const key = `${pluginDir}:pending`;
      const existing = state.fileWatcherTimers.get(key);
      if (existing) clearTimeout(existing);

      state.fileWatcherTimers.set(
        key,
        setTimeout(() => {
          state.fileWatcherTimers.delete(key);
          if (state.fileWatcherGeneration !== gen) return;
          void handlePendingPluginChange(state, pluginDir, callbacks);
        }, 200),
      );
    });
    watchers.push(distWatcher);
  } catch {
    // dist/ may not exist yet — the manifest watcher will still catch changes
  }

  return { pluginDir, pluginName: `(pending:${pluginDir})`, watchers, lastSeenMtimes: new Map() };
};

/**
 * Set up file watching for a single local plugin directory.
 */
const watchPlugin = (
  state: ServerState,
  pluginDir: string,
  pluginName: string,
  callbacks: FileWatcherCallbacks,
): FileWatcherEntry => {
  const watchers: FSWatcher[] = [];
  const distDir = join(pluginDir, 'dist');
  const gen = state.fileWatcherGeneration;

  // Watch plugin directory for manifest changes.
  // Uses directory-level watching (not file-level) because on macOS, file-level
  // fs.watch() via kqueue fails to deliver events after a close + recreate cycle
  // (which happens on every hot reload). Directory-level watching uses FSEvents
  // on macOS and reliably delivers events across watcher restarts.
  try {
    const manifestWatcher = watch(pluginDir, (_eventType, filename) => {
      if (filename !== 'opentabs-plugin.json') return;

      const key = `${pluginDir}:manifest`;
      const existing = state.fileWatcherTimers.get(key);
      if (existing) clearTimeout(existing);

      state.fileWatcherTimers.set(
        key,
        setTimeout(() => {
          state.fileWatcherTimers.delete(key);
          if (state.fileWatcherGeneration !== gen) return;
          void handleManifestChange(state, pluginName, pluginDir, callbacks);
        }, 200),
      );
    });
    watchers.push(manifestWatcher);
  } catch (err) {
    log.warn(`File watcher: Could not watch plugin dir at ${pluginDir}:`, err);
  }

  // Watch dist directory for IIFE changes
  try {
    const distWatcher = watch(distDir, (_eventType, filename) => {
      if (filename !== 'adapter.iife.js') return;

      const key = `${pluginDir}:iife`;
      const existing = state.fileWatcherTimers.get(key);
      if (existing) clearTimeout(existing);

      state.fileWatcherTimers.set(
        key,
        setTimeout(() => {
          state.fileWatcherTimers.delete(key);
          if (state.fileWatcherGeneration !== gen) return;
          void handleIifeChange(state, pluginName, pluginDir, callbacks);
        }, 200),
      );
    });
    watchers.push(distWatcher);
  } catch (err) {
    log.warn(`File watcher: Could not watch dist dir at ${distDir}:`, err);
  }

  return { pluginDir, pluginName, watchers, lastSeenMtimes: new Map() };
};

/**
 * Start watching the config directory for changes to config.json.
 * Uses directory-level watching (not file-level) because on macOS, file-level
 * fs.watch() via kqueue fails to deliver events after a close + recreate cycle.
 * The debounce pattern matches plugin file watchers — uses fileWatcherTimers
 * with a 'config' key and checks fileWatcherGeneration to discard stale callbacks.
 */
const startConfigWatching = (state: ServerState, callbacks: FileWatcherCallbacks): void => {
  // Close any existing config watcher
  if (state.configWatcher) {
    state.configWatcher.close();
    state.configWatcher = null;
  }

  const configDir = getConfigDir();
  const gen = state.fileWatcherGeneration;

  // Record initial config.json mtime for mtime polling fallback
  const configPath = join(configDir, 'config.json');
  state.configLastSeenMtime = getFileMtimeMs(configPath);

  try {
    state.configWatcher = watch(configDir, (_eventType, filename) => {
      if (filename !== 'config.json') return;

      const key = 'config';
      const existing = state.fileWatcherTimers.get(key);
      if (existing) clearTimeout(existing);

      state.fileWatcherTimers.set(
        key,
        setTimeout(() => {
          state.fileWatcherTimers.delete(key);
          if (state.fileWatcherGeneration !== gen) return;
          log.info('Config watcher: config.json changed — triggering reload');
          // Update config mtime for polling fallback
          state.configLastSeenMtime = getFileMtimeMs(configPath);
          callbacks.onConfigChanged();
        }, 200),
      );
    });

    log.info(`Config watcher: Watching ${configDir} for config.json changes`);
  } catch (err) {
    log.warn(`Config watcher: Could not watch config dir at ${configDir}:`, err);
  }
};

/**
 * Start periodic mtime polling as a fallback for stale fs.watch() watchers.
 *
 * fs.watch() can go stale on macOS (FSEvents bug in long-running Bun processes)
 * and Linux (inotify limits). This polling loop stats every watched file and
 * config.json on a fixed interval. If a file's mtime is newer than what was
 * last recorded, the appropriate handler is invoked — the same handler that
 * fs.watch() would have called. Because handlers already debounce and check
 * fileWatcherGeneration, duplicate invocations from both fs.watch() and
 * polling are safely deduplicated.
 */
const startMtimePolling = (state: ServerState, callbacks: FileWatcherCallbacks): void => {
  // Clean up any existing poll timer (defensive — stopFileWatching should clear this)
  if (state.mtimePollTimerId !== null) {
    clearInterval(state.mtimePollTimerId);
    state.mtimePollTimerId = null;
  }

  const gen = state.fileWatcherGeneration;

  state.mtimePollTimerId = setInterval(() => {
    // Bail out if a new generation started (hot reload happened)
    if (state.fileWatcherGeneration !== gen) {
      if (state.mtimePollTimerId !== null) {
        clearInterval(state.mtimePollTimerId);
        state.mtimePollTimerId = null;
      }
      return;
    }

    state.mtimeLastPollAt = Date.now();

    // Poll plugin files (manifest + IIFE)
    for (const entry of state.fileWatcherEntries) {
      const manifestPath = join(entry.pluginDir, 'opentabs-plugin.json');
      const iifePath = join(entry.pluginDir, 'dist', 'adapter.iife.js');

      const isPending = entry.pluginName.startsWith('(pending:');

      // Check manifest mtime
      const manifestMtime = getFileMtimeMs(manifestPath);
      const lastManifestMtime = entry.lastSeenMtimes.get(manifestPath);
      if (manifestMtime !== null && lastManifestMtime !== undefined && manifestMtime > lastManifestMtime) {
        log.info(
          `Mtime poll: Detected change to ${manifestPath} (old=${lastManifestMtime}, new=${manifestMtime}) — fs.watch may be stale`,
        );
        recordPollDetection(state);
        entry.lastSeenMtimes.set(manifestPath, manifestMtime);
        if (isPending) {
          void handlePendingPluginChange(state, entry.pluginDir, callbacks);
        } else {
          void handleManifestChange(state, entry.pluginName, entry.pluginDir, callbacks);
        }
      }

      // Check IIFE mtime
      const iifeMtime = getFileMtimeMs(iifePath);
      const lastIifeMtime = entry.lastSeenMtimes.get(iifePath);
      if (iifeMtime !== null && lastIifeMtime !== undefined && iifeMtime > lastIifeMtime) {
        log.info(
          `Mtime poll: Detected change to ${iifePath} (old=${lastIifeMtime}, new=${iifeMtime}) — fs.watch may be stale`,
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
    if (configMtime !== null && state.configLastSeenMtime !== null && configMtime > state.configLastSeenMtime) {
      log.info(
        `Mtime poll: Detected change to ${configPath} (old=${state.configLastSeenMtime}, new=${configMtime}) — fs.watch may be stale`,
      );
      recordPollDetection(state);
      state.configLastSeenMtime = configMtime;
      callbacks.onConfigChanged();
    }
  }, MTIME_POLL_INTERVAL_MS);

  log.info(`Mtime polling started (interval=${MTIME_POLL_INTERVAL_MS}ms)`);
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
  state.fileWatcherGeneration++;

  // Build set of paths already successfully loaded
  const loadedPaths = new Set<string>();

  // Watch successfully loaded local plugins
  const localPlugins = Array.from(state.plugins.values()).filter(p => p.trustTier === 'local' && p.sourcePath);
  for (const plugin of localPlugins) {
    const srcPath = plugin.sourcePath;
    if (!srcPath) continue;
    loadedPaths.add(srcPath);
    const entry = watchPlugin(state, srcPath, plugin.name, callbacks);
    state.fileWatcherEntries.push(entry);

    // Record initial mtimes for mtime polling fallback
    recordMtime(entry, join(srcPath, 'opentabs-plugin.json'));
    recordMtime(entry, join(srcPath, 'dist', 'adapter.iife.js'));

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
    state.fileWatcherEntries.push(entry);

    // Record initial mtimes for mtime polling fallback
    recordMtime(entry, join(pluginPath, 'opentabs-plugin.json'));
    recordMtime(entry, join(pluginPath, 'dist', 'adapter.iife.js'));

    pendingCount++;

    log.info(`File watcher: Watching pending plugin path at ${pluginPath}`);
  }

  const loadedCount = state.fileWatcherEntries.length - pendingCount;
  if (loadedCount === 0 && pendingCount === 0) {
    log.info('File watcher: No local plugins to watch');
  } else {
    log.info(`File watcher: Watching ${loadedCount} loaded + ${pendingCount} pending plugin path(s)`);
  }

  // Start mtime polling as a fallback for stale fs.watch() watchers
  startMtimePolling(state, callbacks);
};

/**
 * Stop all file watchers and clean up.
 * Reads watcher handles and timers from state (not module-level variables)
 * so that the new module after hot reload can close the old module's watchers.
 */
const stopFileWatching = (state: ServerState): void => {
  for (const entry of state.fileWatcherEntries) {
    for (const watcher of entry.watchers) {
      watcher.close();
    }
  }
  state.fileWatcherEntries.length = 0;

  // Close config watcher
  if (state.configWatcher) {
    state.configWatcher.close();
    state.configWatcher = null;
  }

  // Stop mtime polling
  if (state.mtimePollTimerId !== null) {
    clearInterval(state.mtimePollTimerId);
    state.mtimePollTimerId = null;
  }

  for (const timer of state.fileWatcherTimers.values()) {
    clearTimeout(timer);
  }
  state.fileWatcherTimers.clear();
};

export type { FileWatcherCallbacks };
export { handleManifestChange, startConfigWatching, startFileWatching, stopFileWatching };
