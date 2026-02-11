/**
 * File watcher for local plugins.
 *
 * Watches local plugin directories (from config.json plugins array) for changes
 * to opentabs-plugin.json and dist/adapter.iife.js. On change:
 * - IIFE change → re-read, send plugin.update to extension
 * - Manifest change → re-read, re-register MCP tools, notify MCP clients
 *
 * Only watches local plugins — not npm-installed packages.
 * File change events are debounced at ~200ms.
 */

import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ServerState } from "./state.js";

/** Callbacks for file watcher events */
export interface FileWatcherCallbacks {
  /** Called when a plugin's manifest changes (tools may have changed) */
  onManifestChanged: (pluginName: string) => void;
  /** Send plugin.update to extension with new IIFE */
  onIifeChanged: (pluginName: string, iife: string) => void;
}

/** Active watcher entry */
interface WatcherEntry {
  pluginDir: string;
  pluginName: string;
  watchers: FSWatcher[];
}

/** Debounce timers keyed by plugin directory + file */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Active watcher entries */
const activeWatchers: WatcherEntry[] = [];

/**
 * Read a file with a single retry after a short delay.
 * Handles the case where the file is briefly unavailable during a write.
 */
const readFileWithRetry = async (
  path: string,
  retryDelayMs = 100
): Promise<string> => {
  try {
    return await readFile(path, "utf-8");
  } catch {
    // Wait and retry once
    await new Promise((r) => setTimeout(r, retryDelayMs));
    return await readFile(path, "utf-8");
  }
};

/**
 * Check if a file exists.
 */
const fileExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
};

/**
 * Handle an IIFE file change for a local plugin.
 */
const handleIifeChange = async (
  state: ServerState,
  pluginName: string,
  pluginDir: string,
  callbacks: FileWatcherCallbacks
): Promise<void> => {
  const iifePath = join(pluginDir, "dist", "adapter.iife.js");

  if (!(await fileExists(iifePath))) {
    console.warn(
      `[opentabs] File watcher: IIFE not found at ${iifePath} — skipping`
    );
    return;
  }

  try {
    const iife = await readFileWithRetry(iifePath);
    const plugin = state.plugins.get(pluginName);
    if (!plugin) {
      console.warn(
        `[opentabs] File watcher: Plugin "${pluginName}" not found in state — skipping IIFE update`
      );
      return;
    }

    // Update in-memory state
    plugin.iife = iife;

    console.log(
      `[opentabs] File watcher: IIFE updated for "${pluginName}" — sending plugin.update`
    );

    callbacks.onIifeChanged(pluginName, iife);
  } catch (err) {
    console.error(
      `[opentabs] File watcher: Failed to read IIFE for "${pluginName}":`,
      (err as Error).message
    );
  }
};

/** Manifest shape (same as in discovery.ts) */
interface PluginManifest {
  name: string;
  version: string;
  displayName?: string;
  description: string;
  url_patterns: string[];
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
  }>;
}

/**
 * Handle a manifest file change for a local plugin.
 */
const handleManifestChange = async (
  state: ServerState,
  pluginName: string,
  pluginDir: string,
  callbacks: FileWatcherCallbacks
): Promise<void> => {
  const manifestPath = join(pluginDir, "opentabs-plugin.json");

  if (!(await fileExists(manifestPath))) {
    console.warn(
      `[opentabs] File watcher: Manifest not found at ${manifestPath} — skipping`
    );
    return;
  }

  try {
    const raw = await readFileWithRetry(manifestPath);
    const manifest = JSON.parse(raw) as PluginManifest;
    const plugin = state.plugins.get(pluginName);
    if (!plugin) {
      console.warn(
        `[opentabs] File watcher: Plugin "${pluginName}" not found in state — skipping manifest update`
      );
      return;
    }

    // Update plugin metadata
    plugin.version = manifest.version;
    plugin.displayName = manifest.displayName;
    plugin.urlPatterns = manifest.url_patterns;
    plugin.tools = manifest.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
      output_schema: t.output_schema,
    }));

    console.log(
      `[opentabs] File watcher: Manifest updated for "${pluginName}" — re-registering MCP tools`
    );

    callbacks.onManifestChanged(pluginName);
  } catch (err) {
    console.error(
      `[opentabs] File watcher: Failed to read manifest for "${pluginName}":`,
      (err as Error).message
    );
  }
};

/**
 * Set up file watching for a single local plugin directory.
 */
const watchPlugin = (
  state: ServerState,
  pluginDir: string,
  pluginName: string,
  callbacks: FileWatcherCallbacks
): WatcherEntry => {
  const watchers: FSWatcher[] = [];
  const manifestPath = join(pluginDir, "opentabs-plugin.json");
  const distDir = join(pluginDir, "dist");

  // Watch manifest file
  try {
    const manifestWatcher = watch(manifestPath, () => {
      const key = `${pluginDir}:manifest`;
      const existing = debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      debounceTimers.set(
        key,
        setTimeout(() => {
          debounceTimers.delete(key);
          handleManifestChange(state, pluginName, pluginDir, callbacks);
        }, 200)
      );
    });
    watchers.push(manifestWatcher);
  } catch (err) {
    console.warn(
      `[opentabs] File watcher: Could not watch manifest at ${manifestPath}:`,
      (err as Error).message
    );
  }

  // Watch dist directory for IIFE changes
  try {
    const distWatcher = watch(distDir, (_eventType, filename) => {
      if (filename !== "adapter.iife.js") return;

      const key = `${pluginDir}:iife`;
      const existing = debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      debounceTimers.set(
        key,
        setTimeout(() => {
          debounceTimers.delete(key);
          handleIifeChange(state, pluginName, pluginDir, callbacks);
        }, 200)
      );
    });
    watchers.push(distWatcher);
  } catch (err) {
    console.warn(
      `[opentabs] File watcher: Could not watch dist dir at ${distDir}:`,
      (err as Error).message
    );
  }

  return { pluginDir, pluginName, watchers };
};

/**
 * Start file watching for all local plugins.
 * Uses the sourcePath stored on each local RegisteredPlugin.
 * Only watches local plugins — not npm-installed packages.
 */
export const startFileWatching = (
  state: ServerState,
  callbacks: FileWatcherCallbacks
): void => {
  // Clean up any existing watchers first
  stopFileWatching();

  // Find all local plugins with a source path
  const localPlugins = Array.from(state.plugins.values()).filter(
    (p) => p.trustTier === "local" && p.sourcePath
  );

  if (localPlugins.length === 0) {
    console.log("[opentabs] File watcher: No local plugins to watch");
    return;
  }

  for (const plugin of localPlugins) {
    const entry = watchPlugin(state, plugin.sourcePath!, plugin.name, callbacks);
    activeWatchers.push(entry);

    console.log(
      `[opentabs] File watcher: Watching "${plugin.name}" at ${plugin.sourcePath}`
    );
  }

  console.log(
    `[opentabs] File watcher: Watching ${activeWatchers.length} local plugin(s)`
  );
};

/**
 * Stop all file watchers and clean up.
 */
export const stopFileWatching = (): void => {
  for (const entry of activeWatchers) {
    for (const watcher of entry.watchers) {
      watcher.close();
    }
  }
  activeWatchers.length = 0;

  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
};
