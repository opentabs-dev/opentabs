/**
 * Plugin management operations for the extension WebSocket protocol.
 *
 * Handles npm registry search, plugin installation, name normalization,
 * and validation. These operations are invoked via JSON-RPC methods
 * from the side panel (relayed through the Chrome extension).
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  atomicWrite,
  getConfigDir,
  getConfigPath,
  isValidPluginPackageName,
  isWindows,
  normalizePluginName,
  PLATFORM_PACKAGES,
  resolvePluginPackageCandidates,
} from '@opentabs-dev/shared';
import { pluginNameFromPackage } from './loader.js';
import { log } from './logger.js';
import type { RegisteredPlugin, ServerState } from './state.js';

// ---------------------------------------------------------------------------
// Search result type returned to callers
// ---------------------------------------------------------------------------

interface PluginSearchResult {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  iconSvg: string;
  iconDarkSvg: string;
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
// npm subprocess timeout and output size cap
// ---------------------------------------------------------------------------

const NPM_SUBPROCESS_TIMEOUT_MS = 60_000;

/** Maximum combined stdout+stderr bytes collected from a subprocess before killing it. */
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10 MB

/** Spawn a process asynchronously and return a result promise and a kill handle. */
const spawnAsync = (
  cmd: string,
  args: string[],
): { promise: Promise<{ exitCode: number; stdout: string; stderr: string }>; kill: () => void } => {
  // On Windows, npm/npx are .cmd batch wrappers that require shell to execute.
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows() });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let totalBytes = 0;
  const promise = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_OUTPUT_SIZE) {
        child.kill();
        reject(new Error(`Process output exceeded the ${MAX_OUTPUT_SIZE}-byte size limit`));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_OUTPUT_SIZE) {
        child.kill();
        reject(new Error(`Process output exceeded the ${MAX_OUTPUT_SIZE}-byte size limit`));
        return;
      }
      stderrChunks.push(chunk);
    });
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
  const { promise: resultPromise, kill } = spawnAsync('npm', [command, '-g', packageName]);

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

/**
 * Extracts a short name from an npm package name.
 * "@opentabs-dev/opentabs-plugin-slack" → "slack"
 * "opentabs-plugin-datadog" → "datadog"
 */
const extractShortName = (name: string): string => (name.split('/').pop() ?? name).replace(/^opentabs-plugin-/, '');

/**
 * Converts a package name to a human-readable display name.
 * "@opentabs-dev/opentabs-plugin-slack" → "Slack"
 * "@opentabs-dev/opentabs-plugin-google-calendar" → "Google Calendar"
 */
const toDisplayName = (name: string): string =>
  extractShortName(name)
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const NPM_REGISTRY = 'https://registry.npmjs.org';

/** Shape of a package object within the npm registry search API response. */
interface NpmRegistrySearchPackage {
  name: string;
  description?: string;
  version: string;
  publisher?: { username?: string };
  iconSvg?: string;
  iconDarkSvg?: string;
}

/**
 * Fetch all opentabs plugins from the npm registry search API with pagination.
 * Returns raw package entries; caller is responsible for filtering and mapping.
 */
const fetchAllPlugins = async (signal: AbortSignal): Promise<NpmRegistrySearchPackage[]> => {
  const results: NpmRegistrySearchPackage[] = [];
  let from = 0;
  const size = 250;
  while (true) {
    const url = `${NPM_REGISTRY}/-/v1/search?text=keywords:opentabs-plugin&size=${size}&from=${from}`;
    const resp = await fetch(url, { signal });
    if (!resp.ok) break;
    const data = (await resp.json()) as { objects: Array<{ package: NpmRegistrySearchPackage }>; total: number };
    for (const obj of data.objects) {
      results.push(obj.package);
    }
    if (results.length >= data.total) break;
    from += size;
  }
  return results;
};

/**
 * Probe the npm registry for an exact package match.
 * Tries scoped (@opentabs-dev/opentabs-plugin-{query}) and unscoped (opentabs-plugin-{query})
 * candidates, or probes the query directly if it already looks like a full package name.
 */
const probeDirectPackage = async (query: string, signal: AbortSignal): Promise<NpmRegistrySearchPackage | null> => {
  const candidates = query.startsWith('@')
    ? [query]
    : query.startsWith('opentabs-plugin-')
      ? [`@opentabs-dev/${query}`, query]
      : [`@opentabs-dev/opentabs-plugin-${query}`, `opentabs-plugin-${query}`];

  for (const pkg of candidates) {
    try {
      const resp = await fetch(`${NPM_REGISTRY}/${pkg}`, { signal });
      if (!resp.ok) continue;
      const data = (await resp.json()) as {
        name: string;
        description?: string;
        'dist-tags'?: Record<string, string>;
        versions?: Record<
          string,
          { _npmUser?: { name?: string }; opentabs?: { iconSvg?: string; iconDarkSvg?: string } }
        >;
      };
      const latest = data['dist-tags']?.latest;
      const versionData = latest ? data.versions?.[latest] : undefined;
      return {
        name: data.name,
        description: data.description ?? '',
        version: latest ?? '0.0.0',
        publisher: versionData?._npmUser?.name ? { username: versionData._npmUser.name } : undefined,
        iconSvg: versionData?.opentabs?.iconSvg,
        iconDarkSvg: versionData?.opentabs?.iconDarkSvg,
      };
    } catch {}
  }
  return null;
};

/**
 * Search the npm registry for opentabs plugins via the registry HTTP API.
 * When a query is provided, also performs a direct package probe so exact-name
 * matches (e.g. "notion") are always found even if keyword search ranks them
 * beyond the result window. Direct probe results appear first (exact match priority).
 *
 * @throws Error with `code` property for structured JSON-RPC error handling:
 *   - code -32603: registry search failed
 */
const searchNpmPlugins = async (query?: string): Promise<PluginSearchResult[]> => {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), NPM_SUBPROCESS_TIMEOUT_MS);

  try {
    const [allPackages, probeResult] = await Promise.all([
      fetchAllPlugins(controller.signal),
      query ? probeDirectPackage(query, controller.signal) : Promise.resolve(null),
    ]);

    let filtered: NpmRegistrySearchPackage[];
    if (query) {
      const q = query.toLowerCase();
      filtered = allPackages.filter(
        pkg =>
          pkg.name.toLowerCase().includes(q) ||
          extractShortName(pkg.name).toLowerCase().includes(q) ||
          (pkg.description ?? '').toLowerCase().includes(q),
      );
    } else {
      filtered = allPackages;
    }

    filtered = filtered.filter(pkg => !PLATFORM_PACKAGES.has(pkg.name));

    // Merge: direct probe first, then keyword results (deduplicated by name)
    const seen = new Set<string>();
    const results: PluginSearchResult[] = [];

    if (probeResult && !PLATFORM_PACKAGES.has(probeResult.name)) {
      seen.add(probeResult.name);
      results.push({
        name: probeResult.name,
        displayName: toDisplayName(probeResult.name),
        description: probeResult.description ?? '',
        version: probeResult.version,
        author: probeResult.publisher?.username ?? 'unknown',
        iconSvg: probeResult.iconSvg ?? '',
        iconDarkSvg: probeResult.iconDarkSvg ?? '',
      });
    }

    for (const pkg of filtered) {
      if (seen.has(pkg.name)) continue;
      seen.add(pkg.name);
      results.push({
        name: pkg.name,
        displayName: toDisplayName(pkg.name),
        description: pkg.description ?? '',
        version: pkg.version,
        author: pkg.publisher?.username ?? 'unknown',
        iconSvg: '',
        iconDarkSvg: '',
      });
    }

    // Fetch icon data from the npm registry for results that don't have icons yet.
    // The probe result already has icons from the full packument, but keyword search
    // results need an extra fetch to /<package>/latest for the opentabs field.
    const withIcons = await Promise.all(
      results.map(async result => {
        if (result.iconSvg || result.iconDarkSvg) return result;
        try {
          const resp = await fetch(`${NPM_REGISTRY}/${result.name}/latest`, { signal: controller.signal });
          if (!resp.ok) return result;
          const data = (await resp.json()) as { opentabs?: { iconSvg?: string; iconDarkSvg?: string } };
          return {
            ...result,
            iconSvg: data.opentabs?.iconSvg ?? '',
            iconDarkSvg: data.opentabs?.iconDarkSvg ?? '',
          };
        } catch {
          return result;
        }
      }),
    );

    return withIcons;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      const error = new Error(`npm search timed out after ${NPM_SUBPROCESS_TIMEOUT_MS}ms`) as Error & { code: number };
      error.code = -32603;
      throw error;
    }
    const error = new Error(err instanceof Error ? err.message : 'npm registry search failed') as Error & {
      code: number;
    };
    error.code = -32603;
    throw error;
  } finally {
    clearTimeout(timerId);
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

  if (existing.source === 'local') {
    const error = new Error(
      `Plugin "${name}" is a local plugin — use "cd ${existing.sourcePath ?? name} && npm run build" to update it`,
    ) as Error & { code: number };
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
  const writePromise = (async () => {
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
      const dirName = basename(resolvedPath);

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
      await atomicWrite(configPath, `${JSON.stringify(record, null, 2)}\n`, 0o600);
      removed = true;
    }
  })();
  // The mutex chain always fulfills so subsequent writes proceed even after a failure.
  state.configWriteMutex = writePromise.catch(() => {});
  await writePromise;
  return removed;
};

/**
 * Remove a local plugin from config.json's localPlugins array by exact specifier string.
 * Unlike removeLocalPlugin (which matches by resolved path / package name), this matches
 * the raw string from config.json directly — needed for failed plugins that never loaded
 * and therefore have no name or resolvable path.
 *
 * Uses a read-modify-write pattern serialized via state.configWriteMutex.
 *
 * @returns true if the specifier was found and removed, false if not found
 */
const removeLocalPluginBySpecifier = async (
  state: { configWriteMutex: Promise<void> },
  specifier: string,
): Promise<boolean> => {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  let removed = false;

  const prev = state.configWriteMutex;
  const writePromise = (async () => {
    await prev;
    await mkdir(configDir, { recursive: true, mode: 0o700 });

    let raw: string;
    try {
      raw = await readFile(configPath, 'utf-8');
    } catch {
      log.warn('Cannot remove local plugin by specifier — config file unreadable');
      return;
    }

    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        log.warn('Cannot remove local plugin by specifier — config file is not a JSON object');
        return;
      }
      record = parsed as Record<string, unknown>;
    } catch {
      log.warn('Cannot remove local plugin by specifier — config file contains invalid JSON');
      return;
    }

    const localPlugins = Array.isArray(record.localPlugins)
      ? (record.localPlugins as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];

    const updatedPlugins = localPlugins.filter(p => p !== specifier);

    if (updatedPlugins.length < localPlugins.length) {
      record.localPlugins = updatedPlugins;
      await atomicWrite(configPath, `${JSON.stringify(record, null, 2)}\n`, 0o600);
      removed = true;
    }
  })();
  // The mutex chain always fulfills so subsequent writes proceed even after a failure.
  state.configWriteMutex = writePromise.catch(() => {});
  await writePromise;
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

/**
 * Remove a failed plugin by its discovery specifier (filesystem path).
 *
 * Tries local removal first (from config.localPlugins). If the specifier is
 * not a local plugin, checks whether it is a known npm discovery failure and
 * runs `npm uninstall -g` to remove the broken package.
 *
 * @param specifier - The plugin path from discoveryErrors (e.g., /opt/homebrew/lib/node_modules/...)
 * @param state - Server state (for discoveryErrors, configWriteMutex)
 * @param onReload - Callback to trigger plugin rediscovery after removal
 *
 * @throws Error with `code` property for structured JSON-RPC error handling:
 *   - code -32602: specifier not found in localPlugins or discoveryErrors
 *   - code -32603: npm uninstall failure or unreadable package.json
 */
const removeFailedPlugin = async (
  specifier: string,
  state: ServerState,
  onReload: () => Promise<{ plugins: number; durationMs: number }>,
): Promise<{ ok: true }> => {
  // Try local removal first
  const removedLocal = await removeLocalPluginBySpecifier(state, specifier);
  if (removedLocal) {
    log.info(`Removed failed local plugin by specifier: ${specifier}`);
    await onReload();
    return { ok: true };
  }

  // Check if this is a known npm discovery failure
  const failedEntry = state.discoveryErrors.find(e => e.specifier === specifier && e.source === 'npm');
  if (!failedEntry) {
    const error = new Error(`Plugin not found: ${specifier}`) as Error & { code: number };
    error.code = -32602;
    throw error;
  }

  // Read the npm package name from the specifier's package.json
  let pkgName: string;
  try {
    const raw = await readFile(join(specifier, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { name?: string };
    if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
      const error = new Error(`Cannot read package name from ${specifier}/package.json`) as Error & { code: number };
      error.code = -32603;
      throw error;
    }
    pkgName = pkg.name;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as Error & { code: number }).code === -32603) throw err;
    const error = new Error(`Cannot read ${specifier}/package.json`) as Error & { code: number };
    error.code = -32603;
    throw error;
  }

  if (!isValidPluginPackageName(pkgName)) {
    const error = new Error(`Invalid npm package name: ${pkgName}`) as Error & { code: number };
    error.code = -32603;
    throw error;
  }

  log.info(`Uninstalling failed npm plugin: ${pkgName}`);
  await runNpmGlobal('uninstall', pkgName);
  log.info(`npm uninstall succeeded for ${pkgName}`);

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

export type { CheckUpdatesResult, PluginInstallResult, PluginSearchResult, PluginUpdateResult };
export {
  checkPluginUpdates,
  findPlugin,
  installPlugin,
  isValidPluginPackageName,
  MAX_OUTPUT_SIZE,
  normalizePluginName,
  removeFailedPlugin,
  removeLocalPluginBySpecifier,
  removePlugin,
  searchNpmPlugins,
  spawnAsync,
  updatePlugin,
};
