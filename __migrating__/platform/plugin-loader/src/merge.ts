// =============================================================================
// Plugin Merge — Manifest → ServiceDefinition + Platform Wiring
//
// Converts validated plugin manifests into the platform's internal types:
// - ServiceDefinition (for the dynamic service registry)
// - WebappServiceConfig (for the service controller)
// - ToolRegistrationFn (for the MCP server tool registration pipeline)
//
// Also handles the full plugin resolution pipeline: discover → validate →
// load modules → merge into registry. This is the main entry point that the
// MCP server and browser extension build scripts call.
// =============================================================================

import { discoverPlugins, determineTrustTier } from './discover.js';
import { validateOrThrow, checkNameConflicts, checkUrlPatternOverlaps } from './manifest-schema.js';
import { setServiceRegistry, computeServiceIds } from '@opentabs/core';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscoveredPlugin, DiscoveryOptions } from './discover.js';
import type {
  ServiceDefinition,
  ServiceEnv,
  PluginManifest,
  ResolvedPlugin,
  PluginTrustTier,
  ToolRegistrationFn,
  HealthCheckEvaluator,
  JsonRpcResponse,
} from '@opentabs/core';

// =============================================================================
// Manifest → ServiceDefinition
// =============================================================================

/**
 * Convert a validated plugin manifest into a ServiceDefinition for the
 * platform's dynamic service registry. This is the bridge between the
 * plugin's declarative manifest and the platform's runtime data model.
 *
 * @param manifest - The validated plugin manifest
 * @param packageName - The npm package name (for source tracking)
 * @returns A ServiceDefinition suitable for the service registry
 */
const manifestToServiceDefinition = (manifest: PluginManifest, packageName?: string): ServiceDefinition => ({
  type: manifest.name,
  displayName: manifest.displayName,
  environments: manifest.service.environments as readonly ServiceEnv[],
  domains: manifest.adapter.domains as Readonly<Record<string, string>>,
  urlPatterns: manifest.adapter.urlPatterns as Readonly<Record<string, readonly string[]>>,
  iconName: manifest.name,
  timeout: manifest.service.timeout,
  defaultUrl: manifest.adapter.defaultUrl,
  hostPermissions: manifest.adapter.hostPermissions,
  source: 'plugin',
  packageName,
});

// =============================================================================
// Webapp Service Config — For the Browser Extension's Service Controller
//
// The browser extension's WebappServiceController is data-driven: it reads a
// WebappServiceConfig to know how to manage a service's tab lifecycle, health
// checks, and request dispatch. This function converts a plugin manifest into
// that config shape.
// =============================================================================

/**
 * Health check configuration for the service controller.
 * Mirrors the shape expected by WebappServiceController.
 */
interface ServiceControllerHealthCheck {
  /** JSON-RPC method to send (e.g. 'slack.api') */
  readonly method: string;
  /** JSON-RPC params for the health check */
  readonly params: Record<string, unknown>;
}

/**
 * The config shape consumed by the browser extension's WebappServiceController.
 * Produced from a plugin manifest for each service-environment combination.
 */
interface WebappServiceConfig {
  /** Unique service identifier (e.g. 'slack', 'datadog_production') */
  readonly serviceId: string;
  /** Display name for logging and error messages */
  readonly displayName: string;
  /** Base service type / adapter name */
  readonly adapterName: string;
  /** URL patterns for chrome.tabs.query */
  readonly urlPatterns: string[];
  /** Domain substring for URL matching */
  readonly domain: string;
  /** Strings that indicate authentication failure */
  readonly authErrorPatterns: string[];
  /** Health check configuration */
  readonly healthCheck: ServiceControllerHealthCheck;
  /** Custom health check evaluator (optional) */
  readonly isHealthy?: (response: JsonRpcResponse, authErrorPatterns: string[]) => boolean;
  /** Override for the "not connected" error message */
  readonly notConnectedMessage?: string;
  /** Override for the "tab not found" error message */
  readonly tabNotFoundMessage?: string;
}

/**
 * Convert a plugin manifest into WebappServiceConfig(s) for the extension's
 * service controllers. Multi-environment plugins produce one config per
 * environment; single-environment plugins produce one config.
 *
 * @param manifest - The validated plugin manifest
 * @param isHealthy - Optional custom health evaluator loaded from the plugin module
 * @returns A record of serviceId → WebappServiceConfig
 */
const manifestToServiceConfigs = (
  manifest: PluginManifest,
  isHealthy?: HealthCheckEvaluator,
): Record<string, WebappServiceConfig> => {
  const configs: Record<string, WebappServiceConfig> = {};

  const healthCheck: ServiceControllerHealthCheck = {
    method: manifest.service.healthCheck.method,
    params: { ...manifest.service.healthCheck.params },
  };

  // Resolve the health check evaluator: plugin-exported isHealthy takes
  // precedence; the manifest's evaluator field is a declarative hint that
  // a custom evaluator is expected.
  const resolvedIsHealthy = resolveHealthCheckEvaluator(manifest, isHealthy);

  if (manifest.service.environments.length === 1) {
    const env = manifest.service.environments[0]!;
    const serviceId = manifest.name;
    const urlPatterns = manifest.adapter.urlPatterns[env];
    const domain = manifest.adapter.domains[env];

    if (urlPatterns && domain) {
      configs[serviceId] = {
        serviceId,
        displayName: manifest.displayName,
        adapterName: manifest.name,
        urlPatterns: [...urlPatterns],
        domain,
        authErrorPatterns: [...manifest.service.authErrorPatterns],
        healthCheck,
        isHealthy: resolvedIsHealthy,
        notConnectedMessage: manifest.service.notConnectedMessage,
        tabNotFoundMessage: manifest.service.tabNotFoundMessage,
      };
    }
  } else {
    for (const env of manifest.service.environments) {
      const serviceId = `${manifest.name}_${env}`;
      const urlPatterns = manifest.adapter.urlPatterns[env];
      const domain = manifest.adapter.domains[env];

      if (!urlPatterns || !domain) continue;

      const envDisplayName =
        manifest.service.environments.length > 1
          ? `${manifest.displayName} ${env === 'production' ? 'Production' : 'Staging'}`
          : manifest.displayName;

      configs[serviceId] = {
        serviceId,
        displayName: envDisplayName,
        adapterName: manifest.name,
        urlPatterns: [...urlPatterns],
        domain,
        authErrorPatterns: [...manifest.service.authErrorPatterns],
        healthCheck,
        isHealthy: resolvedIsHealthy,
        notConnectedMessage: manifest.service.notConnectedMessage,
        tabNotFoundMessage: manifest.service.tabNotFoundMessage,
      };
    }
  }

  return configs;
};

// =============================================================================
// Health Check Evaluator Resolution
//
// Plugins provide custom health check evaluation by exporting an `isHealthy`
// function from their tools entry module. The `evaluator` field in the manifest
// is a declarative hint that a custom evaluator is expected — the actual
// implementation comes from the plugin's `isHealthy` export, not from
// hardcoded platform logic.
//
// The platform supplies only the 'default' evaluator (response is healthy if
// it's not a JSON-RPC error). All service-specific evaluators (e.g. checking
// Slack's `ok` field or Snowflake's `user` field) belong in their respective
// plugin packages.
// =============================================================================

/**
 * Validate that a plugin's declared evaluator is backed by an actual `isHealthy`
 * export. When the manifest declares a non-default evaluator but the plugin
 * module doesn't export `isHealthy`, the platform logs a warning and falls back
 * to the default evaluator.
 *
 * @param manifest - The plugin manifest
 * @param isHealthy - The isHealthy export from the plugin's tools module (if any)
 * @returns The resolved evaluator function, or undefined for the default
 */
const resolveHealthCheckEvaluator = (
  manifest: PluginManifest,
  isHealthy?: HealthCheckEvaluator,
): HealthCheckEvaluator | undefined => {
  const evaluatorName = manifest.service.healthCheck.evaluator;

  // No custom evaluator declared — use default (!isJsonRpcError)
  if (!evaluatorName || evaluatorName === 'default') return isHealthy;

  // Custom evaluator declared — the plugin MUST export isHealthy
  if (!isHealthy) {
    console.error(
      `[OpenTabs] Plugin "${manifest.name}" declares health check evaluator "${evaluatorName}" ` +
        `but does not export an isHealthy function from its tools module. ` +
        `Falling back to the default evaluator. To fix this, export an isHealthy ` +
        `function from ${manifest.tools.entry}.`,
    );
    return undefined;
  }

  return isHealthy;
};

// =============================================================================
// Module Loading — Dynamic Import of Plugin Tools
// =============================================================================

/**
 * Dynamically import a plugin's tools module and extract the registerTools
 * function and optional isHealthy evaluator.
 *
 * @param manifest - The validated plugin manifest
 * @param packagePath - Absolute path to the plugin package root
 * @returns The registerTools function and optional isHealthy evaluator
 */
const loadPluginModule = async (
  manifest: PluginManifest,
  packagePath: string,
): Promise<{
  registerTools: ToolRegistrationFn;
  isHealthy?: HealthCheckEvaluator;
}> => {
  const toolsEntry = manifest.tools.entry;

  // Resolve the tools entry relative to the package root
  const absoluteEntry = isAbsolute(toolsEntry) ? toolsEntry : resolve(packagePath, toolsEntry);

  // Append a cache-busting query parameter so that re-imports during hot reload
  // bypass the module cache and pick up fresh code. Without this, Node/Bun
  // returns the cached module for the same URL on subsequent import() calls.
  const entryUrl = `${pathToFileURL(absoluteEntry).href}?t=${Date.now()}`;

  // Dynamic import — the module must export a named `registerTools` function
  const mod = (await import(entryUrl)) as {
    registerTools?: ToolRegistrationFn;
    isHealthy?: HealthCheckEvaluator;
  };

  if (!mod.registerTools || typeof mod.registerTools !== 'function') {
    throw new Error(
      `Plugin "${manifest.name}" tools entry (${toolsEntry}) must export a ` +
        `named "registerTools" function. Got: ${typeof mod.registerTools}`,
    );
  }

  return {
    registerTools: mod.registerTools,
    isHealthy: mod.isHealthy && typeof mod.isHealthy === 'function' ? mod.isHealthy : undefined,
  };
};

// =============================================================================
// Plugin Resolution — The Full Pipeline
// =============================================================================

/**
 * Resolve a discovered plugin into a fully loaded ResolvedPlugin.
 *
 * Accepts a pre-validated manifest to avoid redundant validation. The caller
 * (loadPlugins) validates manifests early — before expensive module loading —
 * and passes the validated manifest here.
 *
 * Steps:
 * 1. Determine trust tier
 * 2. Load the tools module (registerTools + optional isHealthy)
 * 3. Resolve the adapter path
 *
 * @param discovered - A plugin found by the discovery phase
 * @param manifest - The already-validated plugin manifest
 * @returns A fully resolved plugin, or undefined if loading fails
 */
const resolvePlugin = async (
  discovered: DiscoveredPlugin,
  manifest: PluginManifest,
): Promise<ResolvedPlugin | undefined> => {
  // 1. Trust tier
  const trustTier: PluginTrustTier = determineTrustTier(discovered);

  // 2. Load tools module
  let registerTools: ToolRegistrationFn;
  let isHealthy: HealthCheckEvaluator | undefined;

  try {
    const loaded = await loadPluginModule(manifest, discovered.packagePath);
    registerTools = loaded.registerTools;
    isHealthy = loaded.isHealthy;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[OpenTabs] Failed to load tools module for plugin "${manifest.name}": ${message}`);
    return undefined;
  }

  // 3. Resolve adapter path
  const adapterEntry = manifest.adapter.entry;
  const adapterPath = isAbsolute(adapterEntry) ? adapterEntry : resolve(discovered.packagePath, adapterEntry);

  return {
    manifest,
    packagePath: discovered.packagePath,
    adapterPath,
    registerTools,
    isHealthy,
    trustTier,
  };
};

// =============================================================================
// Merge Into Registry
// =============================================================================

/**
 * Merge a set of resolved plugins into a combined service registry,
 * along with any built-in (platform-native) service definitions.
 *
 * The merged registry is set on @opentabs/core via setServiceRegistry(),
 * making it available to all platform modules that call getServiceRegistry().
 *
 * @param builtinDefinitions - Platform-native service definitions (can be empty)
 * @param plugins - Resolved plugins to merge
 * @returns The merged ServiceDefinition array
 */
const mergeIntoRegistry = (
  builtinDefinitions: readonly ServiceDefinition[],
  plugins: readonly ResolvedPlugin[],
): readonly ServiceDefinition[] => {
  const pluginDefinitions = plugins.map(p => manifestToServiceDefinition(p.manifest, p.manifest.name));

  const merged = [...builtinDefinitions, ...pluginDefinitions];

  // Check for name collisions between built-in and plugin services
  const allNames = merged.map(def => def.type);
  const seen = new Set<string>();
  for (const name of allNames) {
    if (seen.has(name)) {
      throw new Error(
        `Service name collision: "${name}" is defined by both a built-in ` +
          `service and a plugin. Plugin names must be unique.`,
      );
    }
    seen.add(name);
  }

  // Set the global registry (freezes it — one-time operation)
  setServiceRegistry(merged);

  return merged;
};

/**
 * Build the merged array of tool registration functions from platform-native
 * tools and plugin tools.
 *
 * @param builtinRegistrations - Platform-native tool registrations (browser, extension)
 * @param plugins - Resolved plugins with their registerTools functions
 * @returns The combined array of registration functions
 */
const mergeToolRegistrations = (
  builtinRegistrations: readonly ToolRegistrationFn[],
  plugins: readonly ResolvedPlugin[],
): ToolRegistrationFn[] => [...builtinRegistrations, ...plugins.map(p => p.registerTools)];

/**
 * Build the merged map of service controller configs from plugin manifests.
 *
 * @param plugins - Resolved plugins
 * @returns A record of serviceId → WebappServiceConfig covering all plugins
 */
const mergeServiceConfigs = (plugins: readonly ResolvedPlugin[]): Record<string, WebappServiceConfig> => {
  const configs: Record<string, WebappServiceConfig> = {};

  for (const plugin of plugins) {
    const pluginConfigs = manifestToServiceConfigs(plugin.manifest, plugin.isHealthy);
    Object.assign(configs, pluginConfigs);
  }

  return configs;
};

// =============================================================================
// High-Level Entry Points
//
// These are the functions that the MCP server and browser extension build
// scripts call. They orchestrate the full pipeline: discover → validate →
// load → merge.
// =============================================================================

/**
 * Result of loading all plugins. Contains everything the platform needs
 * to wire plugins into the MCP server and browser extension.
 */
interface LoadPluginsResult {
  /** All successfully resolved plugins. */
  readonly plugins: readonly ResolvedPlugin[];

  /** The merged service registry (built-in + plugins). */
  readonly registry: readonly ServiceDefinition[];

  /** All service IDs (built-in + plugins). */
  readonly serviceIds: readonly string[];

  /** Merged tool registration functions. */
  readonly toolRegistrations: readonly ToolRegistrationFn[];

  /** Merged service controller configs (for the browser extension). */
  readonly serviceConfigs: Record<string, WebappServiceConfig>;

  /** Plugins that failed to load (package name + error message). */
  readonly failures: readonly PluginLoadFailure[];
}

/** A plugin that was discovered but failed to load. */
interface PluginLoadFailure {
  /** The npm package name. */
  readonly packageName: string;
  /** Human-readable error description. */
  readonly error: string;
}

/**
 * Options for loadPlugins beyond discovery options.
 */
interface LoadPluginsOptions extends DiscoveryOptions {
  /**
   * Skip the registry merge step (setServiceRegistry). Used during hot reload
   * when the registry is already frozen from the initial load.
   *
   * When true, the returned `registry` and `serviceIds` reflect what WOULD be
   * merged, but setServiceRegistry() is not called.
   */
  readonly skipRegistryMerge?: boolean;
}

/**
 * Load all plugins and merge them into the platform.
 *
 * This is the primary entry point for both the MCP server and the browser
 * extension build system. It runs the full discovery → validation → loading →
 * merging pipeline and returns everything the platform needs.
 *
 * @param builtinDefinitions - Platform-native service definitions (can be empty)
 * @param builtinToolRegistrations - Platform-native tool registrations (browser, extension)
 * @param options - Discovery and loading options (root directory, config, verbosity, skipRegistryMerge)
 * @returns The complete LoadPluginsResult
 *
 * @example
 * ```ts
 * // In the MCP server's initialization:
 * const result = await loadPlugins([], [registerBrowserTools, registerExtensionTools], {
 *   rootDir: '/path/to/project',
 * });
 *
 * // Use result.toolRegistrations in registerAllTools()
 * // Use result.registry for service lookups
 * ```
 */
const loadPlugins = async (
  builtinDefinitions: readonly ServiceDefinition[],
  builtinToolRegistrations: readonly ToolRegistrationFn[],
  options?: LoadPluginsOptions,
): Promise<LoadPluginsResult> => {
  const { skipRegistryMerge, ...discoveryOptions } = options ?? {};
  // 1. Discover
  const discovered = await discoverPlugins(discoveryOptions);

  // 2. Validate manifests (early — before expensive module loading).
  //    Track {discovered, manifest} pairs so indices stay in sync.
  const validated: { discovered: DiscoveredPlugin; manifest: PluginManifest }[] = [];
  const failures: PluginLoadFailure[] = [];

  for (const plugin of discovered) {
    try {
      const manifest = validateOrThrow(plugin.rawManifest, plugin.packageName);
      validated.push({ discovered: plugin, manifest });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[OpenTabs] ${message}`);
      failures.push({ packageName: plugin.packageName, error: message });
    }
  }

  // 3. Check for name conflicts and URL pattern overlaps across all validated plugins
  const allManifests = validated.map(v => v.manifest);
  const conflicts = checkNameConflicts(allManifests);
  if (conflicts.length > 0) {
    for (const conflict of conflicts) {
      console.error(`[OpenTabs] Plugin conflict: ${conflict.message}`);
    }
    // Remove conflicting plugins (keep the first occurrence of each name)
    const seenNames = new Set<string>();
    const deduped: typeof validated = [];
    for (const entry of validated) {
      if (seenNames.has(entry.manifest.name)) {
        failures.push({
          packageName: entry.discovered.packageName,
          error: `Name conflict: "${entry.manifest.name}" already claimed by another plugin`,
        });
        continue;
      }
      seenNames.add(entry.manifest.name);
      deduped.push(entry);
    }
    validated.length = 0;
    validated.push(...deduped);
  }

  // 3b. Check for URL pattern overlaps (warnings, not fatal)
  const overlaps = checkUrlPatternOverlaps(validated.map(v => v.manifest));
  for (const overlap of overlaps) {
    console.error(`[OpenTabs] Warning: ${overlap.message}`);
  }

  // 4. Resolve all plugins (load modules).
  //    The manifest is already validated — pass it directly to avoid redundant parsing.
  const resolved: ResolvedPlugin[] = [];
  for (const { discovered: plugin, manifest } of validated) {
    const result = await resolvePlugin(plugin, manifest);
    if (result) {
      resolved.push(result);
    } else {
      failures.push({
        packageName: plugin.packageName,
        error: 'Failed to resolve plugin (see earlier error messages)',
      });
    }
  }

  // 5. Merge into platform (skip registry freeze during hot reload)
  let registry: readonly ServiceDefinition[];
  if (skipRegistryMerge) {
    // Compute what the registry would be without freezing it
    const pluginDefinitions = resolved.map(p => manifestToServiceDefinition(p.manifest, p.manifest.name));
    registry = [...builtinDefinitions, ...pluginDefinitions];
  } else {
    registry = mergeIntoRegistry(builtinDefinitions, resolved);
  }
  const serviceIds = computeServiceIds(registry);
  const toolRegistrations = mergeToolRegistrations(builtinToolRegistrations, resolved);
  const serviceConfigs = mergeServiceConfigs(resolved);

  // Log summary
  if (resolved.length > 0) {
    console.error(`[OpenTabs] Loaded ${resolved.length} plugin(s): ${resolved.map(p => p.manifest.name).join(', ')}`);
  }
  if (failures.length > 0) {
    console.error(
      `[OpenTabs] ${failures.length} plugin(s) failed to load: ${failures.map(f => f.packageName).join(', ')}`,
    );
  }

  return {
    plugins: resolved,
    registry,
    serviceIds,
    toolRegistrations,
    serviceConfigs,
    failures,
  };
};

export type {
  ServiceControllerHealthCheck,
  WebappServiceConfig,
  LoadPluginsResult,
  LoadPluginsOptions,
  PluginLoadFailure,
};

export {
  manifestToServiceDefinition,
  manifestToServiceConfigs,
  resolvePlugin,
  mergeIntoRegistry,
  mergeToolRegistrations,
  mergeServiceConfigs,
  loadPlugins,
};
