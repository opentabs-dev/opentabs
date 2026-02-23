/**
 * Plugin management operations for the extension WebSocket protocol.
 *
 * Handles npm registry search, plugin installation, name normalization,
 * and validation. These operations are invoked via JSON-RPC methods
 * from the side panel (relayed through the Chrome extension).
 */

import { log } from './logger.js';
import { atomicWrite, platformExec } from '@opentabs-dev/shared';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServerState, RegisteredPlugin } from './state.js';

// ---------------------------------------------------------------------------
// npm registry types
// ---------------------------------------------------------------------------

interface NpmSearchPackage {
  name: string;
  description?: string;
  version: string;
  publisher?: { username: string };
}

interface NpmSearchResult {
  objects: Array<{ package: NpmSearchPackage }>;
}

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
// Name normalization and validation
// ---------------------------------------------------------------------------

/**
 * Normalize a shorthand plugin name to its full npm package name.
 * "slack" → "opentabs-plugin-slack", scoped and full names pass through.
 */
const normalizePluginName = (name: string): string => {
  if (name.startsWith('@') || name.startsWith('opentabs-plugin-')) return name;
  return `opentabs-plugin-${name}`;
};

/**
 * Validate that a normalized package name matches the opentabs plugin naming convention.
 * Accepts `opentabs-plugin-*` and `@scope/opentabs-plugin-*` patterns.
 */
const isValidPluginPackageName = (name: string): boolean => {
  if (name.startsWith('@')) {
    return /^@[^/]+\/opentabs-plugin-.+$/.test(name);
  }
  return name.startsWith('opentabs-plugin-') && name.length > 'opentabs-plugin-'.length;
};

// ---------------------------------------------------------------------------
// npm subprocess timeout (60 seconds)
// ---------------------------------------------------------------------------

const NPM_SUBPROCESS_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// npm registry search
// ---------------------------------------------------------------------------

const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';

/**
 * Search the npm registry for opentabs plugins.
 * Returns up to 20 results matching `keywords:opentabs-plugin` + optional query.
 *
 * @throws Error with `code` property for structured JSON-RPC error handling:
 *   - code -32603: registry unreachable or unexpected error
 *   - code -32603 with retryAfterMs: rate limited (HTTP 429)
 */
const searchNpmPlugins = async (query?: string): Promise<PluginSearchResult[]> => {
  const params = new URLSearchParams({
    text: query ? `keywords:opentabs-plugin ${query}` : 'keywords:opentabs-plugin',
    size: '20',
  });

  let response: Response;
  try {
    response = await fetch(`${NPM_SEARCH_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    const error = new Error('npm registry unreachable') as Error & { code: number };
    error.code = -32603;
    throw error;
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
    const error = new Error('npm registry rate limited') as Error & { code: number; retryAfterMs: number };
    error.code = -32603;
    error.retryAfterMs = retryAfterMs;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`npm registry returned HTTP ${response.status}`) as Error & { code: number };
    error.code = -32603;
    throw error;
  }

  const data = (await response.json()) as NpmSearchResult;

  return data.objects.map(({ package: pkg }) => ({
    name: pkg.name,
    description: pkg.description ?? '',
    version: pkg.version,
    author: pkg.publisher?.username ?? 'unknown',
    isOfficial: pkg.name.startsWith('@opentabs-dev/'),
  }));
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

  const proc = Bun.spawn([platformExec('npm'), 'install', '-g', pkg], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeoutId = setTimeout(() => {
    proc.kill();
  }, NPM_SUBPROCESS_TIMEOUT_MS);

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timeoutId);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    log.error(`npm install failed for ${pkg}: exit code ${exitCode}, stderr: ${stderr}`);
    const error = new Error(`npm install failed (exit code ${exitCode})`) as Error & {
      code: number;
      data: { stderr: string; stdout: string };
    };
    error.code = -32603;
    error.data = { stderr, stdout };
    throw error;
  }

  log.info(`npm install succeeded for ${pkg}, triggering rediscovery`);

  // Trigger rediscovery so the new plugin appears in the registry
  await onReload();

  // Find the newly installed plugin in the refreshed registry.
  // Match by npm package name or by plugin name derived from the package name.
  const segments = pkg.startsWith('@') ? pkg.split('/') : undefined;
  const pluginName = segments ? (segments[1] ?? pkg) : pkg;
  const strippedName = pluginName.replace(/^opentabs-plugin-/, '');

  let installedPlugin: { name: string; displayName: string; version: string; toolCount: number } | undefined;
  for (const p of state.registry.plugins.values()) {
    if (p.npmPackageName === pkg || p.name === strippedName || p.name === pluginName) {
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
 * Returns the matching RegisteredPlugin or undefined.
 */
const findPlugin = (state: ServerState, name: string): RegisteredPlugin | undefined => {
  const pkg = normalizePluginName(name);
  const segments = pkg.startsWith('@') ? pkg.split('/') : undefined;
  const pluginName = segments ? (segments[1] ?? pkg) : pkg;
  const strippedName = pluginName.replace(/^opentabs-plugin-/, '');

  for (const p of state.registry.plugins.values()) {
    if (p.npmPackageName === pkg || p.name === strippedName || p.name === pluginName || p.name === name) {
      return p;
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

  const proc = Bun.spawn([platformExec('npm'), 'update', '-g', pkg], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeoutId = setTimeout(() => {
    proc.kill();
  }, NPM_SUBPROCESS_TIMEOUT_MS);

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timeoutId);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    log.error(`npm update failed for ${pkg}: exit code ${exitCode}, stderr: ${stderr}`);
    const error = new Error(`npm update failed (exit code ${exitCode})`) as Error & {
      code: number;
      data: { stderr: string; stdout: string };
    };
    error.code = -32603;
    error.data = { stderr, stdout };
    throw error;
  }

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
 * Read the config directory, checking the environment variable on each call.
 * Duplicated from config.ts to avoid circular dependencies — plugin-management
 * only needs config reading for removeLocalPlugin, not the full config module.
 */
const getConfigDir = (): string => Bun.env.OPENTABS_CONFIG_DIR || join(homedir(), '.opentabs');
const getConfigPath = (): string => join(getConfigDir(), 'config.json');

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
      raw = await Bun.file(configPath).text();
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
    const updatedPlugins: string[] = [];
    for (const pluginPath of localPlugins) {
      const resolvedPath = pluginPath.startsWith('~/')
        ? join(homedir(), pluginPath.slice(2))
        : resolve(configDir, pluginPath);
      const dirName = resolvedPath.split('/').pop() ?? '';

      // Check if the directory name matches the plugin name
      if (dirName === pluginName || dirName === `opentabs-plugin-${pluginName}`) {
        removed = true;
        continue;
      }

      // Check if the package.json name matches
      try {
        const pkgRaw = await Bun.file(join(resolvedPath, 'package.json')).text();
        const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
        const pkgName = typeof pkg.name === 'string' ? pkg.name : '';
        const stripped = pkgName.replace(/^opentabs-plugin-/, '');
        if (stripped === pluginName || pkgName === pluginName) {
          removed = true;
          continue;
        }
      } catch {
        // Cannot read package.json — keep this entry
      }

      updatedPlugins.push(pluginPath);
    }

    if (removed) {
      record.localPlugins = updatedPlugins;
      await atomicWrite(configPath, JSON.stringify(record, null, 2) + '\n', 0o600);
    }
  })().catch((err: unknown) => {
    state.configWriteMutex = Promise.resolve();
    log.warn(`Failed to remove local plugin from config:`, err);
    throw err;
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

    const proc = Bun.spawn([platformExec('npm'), 'uninstall', '-g', pkg], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
    }, NPM_SUBPROCESS_TIMEOUT_MS);

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    clearTimeout(timeoutId);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      log.error(`npm uninstall failed for ${pkg}: exit code ${exitCode}, stderr: ${stderr}`);
      const error = new Error(`npm uninstall failed (exit code ${exitCode})`) as Error & {
        code: number;
        data: { stderr: string; stdout: string };
      };
      error.code = -32603;
      error.data = { stderr, stdout };
      throw error;
    }

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
