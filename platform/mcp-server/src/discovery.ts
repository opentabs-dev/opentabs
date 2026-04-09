/** Plugin discovery orchestrator: resolve → load → register pipeline. */

import { isErr, toErrorMessage } from '@opentabs-dev/shared';
import type { LoadedPlugin } from './loader.js';
import { loadPlugin } from './loader.js';
import { log } from './logger.js';
import { buildRegistry } from './registry.js';
import { discoverGlobalNpmPlugins, resolvePluginPath } from './resolver.js';
import { resolvePluginSettings } from './settings-resolver.js';
import { isSkipNpmDiscovery } from './skip-npm-discovery.js';
import type { FailedPlugin, PluginRegistry, RegisteredPlugin } from './state.js';

/** Outcome of plugin discovery: an immutable registry plus any errors from failed plugins. */
interface DiscoveryResult {
  readonly registry: PluginRegistry;
  readonly errors: readonly DiscoveryError[];
}

/** A single plugin that failed to load during discovery, identified by its specifier. */
interface DiscoveryError {
  readonly specifier: string;
  readonly error: string;
  readonly source: 'npm' | 'local';
}

/**
 * Discover plugins from auto-discovered npm globals and explicit local paths.
 *
 * Phase 1: Discover npm plugins from global node_modules (auto-discovery).
 * Phase 2: Resolve local plugin paths from config.localPlugins.
 * Phase 3: Load all plugins in parallel.
 * Phase 4: Merge — local plugins override npm plugins of the same name.
 * Phase 5: Build immutable registry.
 */
const discoverPlugins = async (
  localPlugins: string[],
  configDir: string,
  pluginSettings?: Record<string, Record<string, unknown>>,
  additionalAllowedDirs?: readonly string[],
): Promise<DiscoveryResult> => {
  log.info('Starting plugin discovery...');

  const errors: DiscoveryError[] = [];
  const failures: FailedPlugin[] = [];

  // Phase 1: Auto-discover npm plugins from global node_modules
  const { dirs: npmDirs, errors: npmErrors } = isSkipNpmDiscovery()
    ? { dirs: [], errors: [] }
    : await discoverGlobalNpmPlugins();
  for (const npmErr of npmErrors) {
    errors.push({ specifier: '(npm auto-discovery)', error: npmErr, source: 'npm' });
  }

  // Phase 2 + 3: Resolve and load all plugins in parallel
  const loadNpm = npmDirs.map(async (dir): Promise<LoadedPlugin | null> => {
    const loadResult = await loadPlugin(dir, 'npm');
    if (isErr(loadResult)) {
      errors.push({ specifier: dir, error: loadResult.error, source: 'npm' });
      failures.push({ path: dir, error: loadResult.error });
      return null;
    }
    return loadResult.value;
  });

  const loadLocal = localPlugins.map(async (specifier): Promise<LoadedPlugin | null> => {
    const resolveResult = await resolvePluginPath(specifier, configDir, additionalAllowedDirs);
    if (isErr(resolveResult)) {
      // "Path not found" means the directory no longer exists — treat as a stale config
      // entry and skip silently (only log, don't add to failedPlugins).
      const isStale = resolveResult.error.startsWith('Path not found:');
      errors.push({ specifier, error: resolveResult.error, source: 'local' });
      if (!isStale) {
        failures.push({ path: specifier, error: resolveResult.error });
      }
      return null;
    }

    const dir = resolveResult.value;
    const loadResult = await loadPlugin(dir, 'local');
    if (isErr(loadResult)) {
      errors.push({ specifier, error: loadResult.error, source: 'local' });
      failures.push({ path: dir, error: loadResult.error });
      return null;
    }

    return loadResult.value;
  });

  const [npmSettled, localSettled] = await Promise.all([Promise.allSettled(loadNpm), Promise.allSettled(loadLocal)]);

  // Collect results
  const collectLoaded = (
    settled: PromiseSettledResult<LoadedPlugin | null>[],
    source: 'npm' | 'local',
  ): LoadedPlugin[] => {
    const loaded: LoadedPlugin[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value !== null) {
        loaded.push(result.value);
      } else if (result.status === 'rejected') {
        const errorMsg = toErrorMessage(result.reason);
        errors.push({ specifier: '(unknown)', error: errorMsg, source });
      }
    }
    return loaded;
  };

  const npmLoaded = collectLoaded(npmSettled, 'npm');
  const localLoaded = collectLoaded(localSettled, 'local');

  // Phase 4: Merge — local plugins override npm plugins of the same name
  const merged = new Map<string, LoadedPlugin>();
  for (const plugin of npmLoaded) {
    merged.set(plugin.name, plugin);
  }
  for (const plugin of localLoaded) {
    if (merged.has(plugin.name)) {
      log.info(`Local plugin "${plugin.name}" overrides npm auto-discovered version`);
    }
    merged.set(plugin.name, plugin);
  }

  // Phase 4.5: Apply settings resolution — derive URL patterns from url-type settings
  const resolved: RegisteredPlugin[] = Array.from(merged.values()).map(plugin => {
    const settings = pluginSettings?.[plugin.name];
    if (!plugin.configSchema && !settings) return plugin;

    const { effectiveUrlPatterns, effectiveHomepage, instanceMap } = resolvePluginSettings(
      plugin.name,
      plugin.urlPatterns,
      plugin.homepage,
      plugin.configSchema,
      settings,
    );
    return {
      ...plugin,
      urlPatterns: effectiveUrlPatterns,
      homepage: effectiveHomepage,
      ...(Object.keys(instanceMap).length > 0 ? { instanceMap } : {}),
    };
  });

  // Phase 5: Build immutable registry
  const registry = buildRegistry(resolved, failures);

  for (const plugin of registry.plugins.values()) {
    const toolNames = plugin.tools.map(t => t.name).join(', ');
    log.info(
      `Discovered plugin: ${plugin.name} v${plugin.version} (${plugin.source}) from ${plugin.sourcePath ?? '(npm)'} — tools: [${toolNames}]`,
    );
  }

  log.info(`Plugin discovery complete: ${registry.plugins.size} plugin(s) loaded, ${errors.length} error(s)`);

  return { registry, errors };
};

export type { DiscoveryError, DiscoveryResult };
export { discoverPlugins };
