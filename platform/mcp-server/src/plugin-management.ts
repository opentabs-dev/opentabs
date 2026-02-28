/**
 * Plugin management operations for the extension WebSocket protocol.
 *
 * Handles npm registry search, plugin installation, name normalization,
 * and validation. These operations are invoked via JSON-RPC methods
 * from the side panel (relayed through the Chrome extension).
 */

import { pluginNameFromPackage } from './loader.js';
import { log } from './logger.js';
import {
  atomicWrite,
  getConfigDir,
  getConfigPath,
  OFFICIAL_SCOPE,
  normalizePluginName,
  isValidPluginPackageName,
  resolvePluginPackageCandidates,
  platformExec,
} from '@opentabs-dev/shared';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServerState, RegisteredPlugin } from './state.js';

// ---------------------------------------------------------------------------
// Search result type returned to callers
// ---------------------------------------------------------------------------

interface PluginSearchResult {
  name: string;
  description: string;
  version: string;
  author: string;
  isOfficial: boolean;
}

// ---------------------------------------------------------------------------
// Install result type returned to callers
// ---------------------------------------------------------------------------

interface PluginInstallResult {
  ok: true;
  plugin: {
    name: string;
    displayName: string;
    version: string;
    toolCount: number;
  };
}

// ---------------------------------------------------------------------------
// Name normalization and validation — re-exported from @opentabs-dev/shared
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// npm subprocess timeout
// ---------------------------------------------------------------------------

const NPM_SUBPROCESS_TIMEOUT_MS = 60_000;

/** Spawn a process asynchronously and return a result promise and a kill handle. */
const spawnAsync = (
  cmd: string,
  args: string[],
): { promise: Promise<{ exitCode: number; stdout: string; stderr: string }>; kill: () => void } => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  const promise = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
      });
    });
  });
  return {
    promise,
    kill: () => {
      child.kill();
    },
  };
};

/**
 * Run an npm command globally with the given package name.
 * Applies a 60s timeout via Promise.race against the spawnAsync result.
 *
 * @throws Error with code -32603 and data { stderr, stdout } on non-zero exit or timeout
 */
const runNpmGlobal = async (command: string, packageName: string): Promise<{ stdout: string; stderr: string }> => {
  const { promise: resultPromise, kill } = spawnAsync(platformExec('npm'), [command, '-g', packageName]);

  let rejectTimeout: (reason: Error) => void;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timerId = setTimeout(
    () => rejectTimeout(new Error(`npm ${command} timed out after ${NPM_SUBPROCESS_TIMEOUT_MS}ms`)),
    NPM_SUBPROCESS_TIMEOUT_MS,
  );

  let result: Awaited<typeof resultPromise>;
  try {
    result = await Promise.race([resultPromise, timeoutPromise]);
  } finally {
    clearTimeout(timerId);
    kill();
  }

  if (result.exitCode !== 0) {
    log.error(`npm ${command} failed for ${packageName}: exit code ${result.exitCode}, stderr: ${result.stderr}`);
    const error = new Error(`npm ${command} failed (exit code ${result.exitCode})`) as Error & {
      code: number;
      data: { stderr: string; stdout: string };
    };
    error.code = -32603;
    error.data = { stderr: result.stderr, stdout: result.stdout };
    throw error;
  }

  return { stdout: result.stdout, stderr: result.stderr };
};

// ---------------------------------------------------------------------------
// npm registry search
// ---------------------------------------------------------------------------

/** npm search --json result shape */
interface NpmSearchJsonEntry {
  name: string;
  description?: string;
  version: string;
  author?: { name?: string };
  publisher?: { username?: string };
}

/**
 * Search the npm registry for opentabs plugins via `npm search`.
 * Delegates auth to npm itself (reads ~/.npmrc), supporting private packages.
 *
 * @throws Error with `code` property for structured JSON-RPC error handling:
 *   - code -32603: npm search failed
 */
const searchNpmPlugins = async (query?: string): Promise<PluginSearchResult[]> => {
  const searchTerm = query ? `keywords:opentabs-plugin ${query}` : 'keywords:opentabs-plugin';
  const { promise: resultPromise, kill } = spawnAsync(platformExec('npm'), ['search', searchTerm, '--json']);

  let rejectTimeout: (reason: Error) => void;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timerId = setTimeout(
    () => rejectTimeout(new Error(`npm search timed out after ${NPM_SUBPROCESS_TIMEOUT_MS}ms`)),
    NPM_SUBPROCESS_TIMEOUT_MS,
  );

  let result: Awaited<typeof resultPromise>;
  try {
    result = await Promise.race([resultPromise, timeoutPromise]);
  } finally {
    clearTimeout(timerId);
    kill();
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    const error = new Error(stderr || 'npm search failed') as Error & { code: number };
    error.code = -32603;
    throw error;
  }

  try {
    const entries = JSON.parse(result.stdout.trim()) as NpmSearchJsonEntry[];
    return entries.map(entry => ({
      name: entry.name,
      description: entry.description ?? '',
      version: entry.version,
      author: entry.publisher?.username ?? entry.author?.name ?? 'unknown',
      isOfficial: entry.name.startsWith(`${OFFICIAL_SCOPE}/`),
    }));
  } catch {
    const error = new Error('Failed to parse npm search output') as Error & { code: number };
    error.code = -32603;
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Plugin installation via npm
// ---------------------------------------------------------------------------

/**
 * Install a plugin from npm globally and trigger server rediscovery.
 *
 * @param name - Plugin name (shorthand or full npm package name)
 * @param state - Server state (used to look up installed plugin after rediscovery)
 * @param onReload - Callback to trigger plugin rediscovery
 * @returns Install result with plugin metadata
 *
 * @throws Error with `code` property for structured JSON-RPC error handling:
 *   - code -32602: invalid params or naming convention violation
 *   - code -32603: npm install failure
 */
const installPlugin = async (
  name: string,
  state: ServerState,
  onReload: () => Promise<{ plugins: number; durationMs: number }>,
): Promise<PluginInstallResult> => {
  const pkg = normalizePluginName(name);

  if (!isValidPluginPackageName(pkg)) {
    const error = new Error(
      `Invalid plugin name: "${pkg}" does not match opentabs-plugin-* or @scope/opentabs-plugin-* pattern`,
    ) as Error & { code: number };
    error.code = -32602;
    throw error;
  }

  log.info(`Installing plugin: ${pkg}`);
  await runNpmGlobal('install', pkg);
  log.info(`npm install succeeded for ${pkg}, triggering rediscovery`);

  // Trigger rediscovery so the new plugin appears in the registry
  await onReload();

  // Find the newly installed plugin in the refreshed registry.
  // Match by npm package name or by the internal name derived from the package name.
  const derivedName = pluginNameFromPackage(pkg);

  let installedPlugin: { name: string; displayName: string; version: string; toolCount: number } | undefined;
  for (const p of state.registry.plugins.values()) {
    if (p.npmPackageName === pkg || p.name === derivedName) {
      installedPlugin = {
        name: p.name,
        displayName: p.displayName,
        version: p.version,
        toolCount: p.tools.length,
      };
      break;
    }
  }

  if (!installedPlugin) {
    const error = new Error(
      `Package "${pkg}" was installed but is not a valid opentabs plugin (no opentabs field in package.json or missing dist/tools.json)`,
    ) as Error & { code: number };
    error.code = -32603;
    throw error;
  }

  return { ok: true, plugin: installedPlugin };
};

// ---------------------------------------------------------------------------
// Plugin update via npm
// ---------------------------------------------------------------------------

/**
 * Update result type returned to callers
 */
interface PluginUpdateResult {
  ok: true;
  plugin: {
    name: string;
    displayName: string;
    version: string;
    toolCount: number;
  };
}

/**
 * Find a registered plugin by name (shorthand or full npm package name).
 *
 * Tries all candidate package names for shorthand inputs (official scoped first,
 * then community unscoped) to match against both `npmPackageName` and the
 * derived internal name.
 */
const findPlugin = (state: ServerState, name: string): RegisteredPlugin | undefined => {
  const candidates = resolvePluginPackageCandidates(name);

  for (const p of state.registry.plugins.values()) {
    if (p.name === name) return p;
    for (const candidate of candidates) {
      if (p.npmPackageName === candidate || p.name === pluginNameFromPackage(candidate)) {
        return p;
      }
    }
  }
  return undefined;
};

/**
 * Update a plugin from npm and trigger server rediscovery.
 *
 * @param name - Plugin name (shorthand or full npm package name)
 * @param state - Server state (used to verify plugin exists and look up result)
 * @param onReload - Callback to trigger plugin rediscovery
 * @returns Update result with plugin metadata
 *
 * @throws Error with `code` property for structured JSON-RPC error handling:
 *   - code -32602: plugin not currently installed
 *   - code -32603: npm update failure
 */
const updatePlugin = async (
  name: string,
  state: ServerState,
  onReload: () => Promise<{ plugins: number; durationMs: number }>,
): Promise<PluginUpdateResult> => {
  const existing = findPlugin(state, name);
  if (!existing) {
    const error = new Error(`Plugin "${name}" is not currently installed`) as Error & { code: number };
    error.code = -32602;
    throw error;
  }

  const pkg = existing.npmPackageName ?? normalizePluginName(name);

  log.info(`Updating plugin: ${pkg}`);
  await runNpmGlobal('update', pkg);
  log.info(`npm update succeeded for ${pkg}, triggering rediscovery`);

  await onReload();

  const updated = findPlugin(state, name);
  if (!updated) {
    const error = new Error(
      `Plugin "${pkg}" disappeared after update — it may no longer be a valid opentabs plugin`,
    ) as Error & { code: number };
    error.code = -32603;
    throw error;
  }

  return {
    ok: true,
    plugin: {
      name: updated.name,
      displayName: updated.displayName,
      version: updated.version,
      toolCount: updated.tools.length,
    },
  };
};

// ---------------------------------------------------------------------------
// Plugin removal
// ---------------------------------------------------------------------------

/**
 * Remove a local plugin from config.json's localPlugins array.
 * Uses a read-modify-write pattern serialized via state.configWriteMutex.
 *
 * @returns true if the plugin was found and removed, false if not found
 */
const removeLocalPlugin = async (state: { configWriteMutex: Promise<void> }, pluginName: string): Promise<boolean> => {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  let removed = false;

  const prev = state.configWriteMutex;
  state.configWriteMutex = (async () => {
    await prev;
    await mkdir(configDir, { recursive: true, mode: 0o700 });

    let raw: string;
    try {
      raw = await readFile(configPath, 'utf-8');
    } catch {
      log.warn('Cannot remove local plugin — config file unreadable');
      return;
    }

    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        log.warn('Cannot remove local plugin — config file is not a JSON object');
        return;
      }
      record = parsed as Record<string, unknown>;
    } catch {
      log.warn('Cannot remove local plugin — config file contains invalid JSON');
      return;
    }

    const localPlugins = Array.isArray(record.localPlugins)
      ? (record.localPlugins as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];

    // Match by checking if any local plugin path resolves to a package with the given name.
    // We try multiple matching strategies:
    // 1. Path ends with the plugin name directory
    // 2. The resolved path's package.json has a matching name
    let found = false;
    const updatedPlugins: string[] = [];
    for (const pluginPath of localPlugins) {
      const resolvedPath = pluginPath.startsWith('~/')
        ? join(homedir(), pluginPath.slice(2))
        : resolve(configDir, pluginPath);
      const dirName = resolvedPath.split('/').pop() ?? '';

      // Check if the directory name matches the plugin name
      if (dirName === pluginName || dirName === `opentabs-plugin-${pluginName}`) {
        found = true;
        continue;
      }

      // Check if the package.json name matches
      try {
        const pkg = JSON.parse(await readFile(join(resolvedPath, 'package.json'), 'utf-8')) as Record<string, unknown>;
        const pkgName = typeof pkg.name === 'string' ? pkg.name : '';
        const derivedPkgName = pluginNameFromPackage(pkgName);
        if (derivedPkgName === pluginName || pkgName === pluginName) {
          found = true;
          continue;
        }
      } catch {
        // Cannot read package.json — keep this entry
      }

      updatedPlugins.push(pluginPath);
    }

    if (found) {
      record.localPlugins = updatedPlugins;
      await atomicWrite(configPath, JSON.stringify(record, null, 2) + '\n', 0o600);
      removed = true;
    }
  })().catch((err: unknown) => {
    log.warn(`Failed to remove local plugin from config:`, err);
  });

  await state.configWriteMutex;
  return removed;
};

/**
 * Remove a plugin (npm or local) and trigger server rediscovery.
 *
 * @param name - Plugin name (shorthand or full npm package name)
 * @param state - Server state
 * @param onReload - Callback to trigger plugin rediscovery
 * @returns `{ ok: true }` on success
 *
 * @throws Error with `code` property for structured JSON-RPC error handling:
 *   - code -32602: plugin not currently installed
 *   - code -32603: npm uninstall failure
 */
const removePlugin = async (
  name: string,
  state: ServerState,
  onReload: () => Promise<{ plugins: number; durationMs: number }>,
): Promise<{ ok: true }> => {
  const existing = findPlugin(state, name);
  if (!existing) {
    const error = new Error(`Plugin "${name}" is not currently installed`) as Error & { code: number };
    error.code = -32602;
    throw error;
  }

  if (existing.source === 'local') {
    // Local plugin — remove from config.json localPlugins
    const removed = await removeLocalPlugin(state, existing.name);
    if (!removed) {
      const error = new Error(`Plugin "${name}" not found in localPlugins config`) as Error & { code: number };
      error.code = -32602;
      throw error;
    }
    log.info(`Removed local plugin "${existing.name}" from config`);
  } else {
    // npm plugin — uninstall globally
    const pkg = existing.npmPackageName ?? normalizePluginName(name);

    log.info(`Uninstalling plugin: ${pkg}`);
    await runNpmGlobal('uninstall', pkg);
    log.info(`npm uninstall succeeded for ${pkg}`);
  }

  // Trigger rediscovery to refresh the registry
  await onReload();

  return { ok: true };
};

// ---------------------------------------------------------------------------
// Check for outdated plugins
// ---------------------------------------------------------------------------

/**
 * Check outdated plugins result type
 */
interface CheckUpdatesResult {
  outdatedPlugins: Array<{
    name: string;
    currentVersion: string;
    latestVersion: string;
    updateCommand: string;
  }>;
}

/**
 * Check all npm-installed plugins for updates using the existing version-check logic.
 * Calls checkForUpdates to populate state.outdatedPlugins, then returns the results.
 */
const checkPluginUpdates = async (state: ServerState): Promise<CheckUpdatesResult> => {
  const { checkForUpdates } = await import('./version-check.js');
  await checkForUpdates(state);
  return { outdatedPlugins: state.outdatedPlugins };
};

export type { PluginSearchResult, PluginInstallResult, PluginUpdateResult, CheckUpdatesResult };
export {
  normalizePluginName,
  isValidPluginPackageName,
  searchNpmPlugins,
  installPlugin,
  updatePlugin,
  removePlugin,
  checkPluginUpdates,
  findPlugin,
};
