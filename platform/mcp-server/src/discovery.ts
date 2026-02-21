/**
 * Plugin discovery orchestrator.
 *
 * Composes the resolve → load → register pipeline into a single function.
 * Each specifier from config.plugins is resolved to an absolute path,
 * loaded into a LoadedPlugin, and assembled into an immutable PluginRegistry.
 * Errors at any phase are collected and returned alongside successful results.
 */

import { loadPlugin } from './loader.js';
import { log } from './logger.js';
import { buildRegistry } from './registry.js';
import { isLocalPath, resolvePluginPath } from './resolver.js';
import { isErr } from '@opentabs-dev/shared';
import type { LoadedPlugin } from './loader.js';
import type { PluginRegistry } from './registry.js';
import type { FailedPlugin } from './state.js';
import type { TrustTier } from '@opentabs-dev/shared';

/** Result of full plugin discovery */
interface DiscoveryResult {
  readonly registry: PluginRegistry;
  readonly errors: readonly DiscoveryError[];
}

/** A single discovery failure, tied to the specifier that caused it */
interface DiscoveryError {
  readonly specifier: string;
  readonly error: string;
}

/**
 * Determine trust tier from a plugin specifier.
 * Local paths are 'local', @opentabs-dev/ packages are 'official',
 * all other npm packages are 'community'.
 */
const determineTrustTier = (specifier: string): TrustTier => {
  if (isLocalPath(specifier)) return 'local';
  if (specifier.startsWith('@opentabs-dev/')) return 'official';
  return 'community';
};

/**
 * Discover plugins from an array of specifiers (npm package names or local paths).
 *
 * Phase 1: Resolve all specifiers to absolute directory paths in parallel.
 * Phase 2: Load all resolved directories in parallel.
 * Phase 3: Determine trust tier for each from the original specifier.
 * Phase 4: Build an immutable PluginRegistry from loaded plugins.
 *
 * Errors from any phase are collected and returned — successful plugins
 * continue even if some fail.
 */
const discoverPlugins = async (specifiers: string[], configDir: string): Promise<DiscoveryResult> => {
  log.info('Starting plugin discovery...');

  const errors: DiscoveryError[] = [];
  const failures: FailedPlugin[] = [];

  // Phase 1 + 2 + 3: Resolve, load, and tag each specifier in parallel
  const settled = await Promise.allSettled(
    specifiers.map(async (specifier): Promise<LoadedPlugin | null> => {
      const resolveResult = await resolvePluginPath(specifier, configDir);
      if (isErr(resolveResult)) {
        errors.push({ specifier, error: resolveResult.error });
        failures.push({ path: specifier, error: resolveResult.error });
        return null;
      }

      const dir = resolveResult.value;
      const trustTier = determineTrustTier(specifier);
      const loadResult = await loadPlugin(dir, trustTier);
      if (isErr(loadResult)) {
        errors.push({ specifier, error: loadResult.error });
        failures.push({ path: dir, error: loadResult.error });
        return null;
      }

      return loadResult.value;
    }),
  );

  // Collect successfully loaded plugins, skipping nulls and rejections
  const loaded: LoadedPlugin[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value !== null) {
      loaded.push(result.value);
    } else if (result.status === 'rejected') {
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push({ specifier: '(unknown)', error: errorMsg });
    }
  }

  // Phase 4: Build immutable registry
  const registry = buildRegistry(loaded, failures);

  for (const plugin of registry.plugins.values()) {
    const toolNames = plugin.tools.map(t => t.name).join(', ');
    log.info(
      `Discovered plugin: ${plugin.name} v${plugin.version} (${plugin.trustTier}) from ${plugin.sourcePath} — tools: [${toolNames}]`,
    );
  }

  log.info(`Plugin discovery complete: ${registry.plugins.size} plugin(s) loaded, ${errors.length} error(s)`);

  return { registry, errors };
};

export { determineTrustTier, discoverPlugins };
export type { DiscoveryError, DiscoveryResult };
