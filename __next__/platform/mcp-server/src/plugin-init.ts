// =============================================================================
// Plugin Initialization for the MCP Server
//
// This module is the bridge between the @opentabs/plugin-loader and the MCP
// server's tool registration pipeline. It runs during server startup (before
// any MCP client sessions are created) and performs the following:
//
//   1. Calls loadPlugins() from @opentabs/plugin-loader to discover, validate,
//      and dynamically import all installed plugin packages.
//
//   2. Wires the plugin-sdk's request provider so that plugin tools can call
//      sendServiceRequest() / sendBrowserRequest() without importing the
//      WebSocket relay directly.
//
//   3. Injects the discovered plugin tool registrations into the tools/index.ts
//      module via setPluginRegistrations(), making them available to
//      registerAllTools().
//
//   4. Returns a summary of what was loaded, for logging and health checks.
//
// On hot reload (bun --hot), this module re-evaluates and re-discovers plugins.
// New plugins installed since the last reload are picked up automatically.
// Removed plugins are no longer registered on new sessions (existing sessions
// keep their tools until the next hot-patch cycle).
//
// This module is imported by server.ts during startup and by the hot-reload
// handler when patching existing sessions.
// =============================================================================

import { setPluginRegistrations } from './tools/index.js';
import { loadPlugins, manifestToServiceDefinition, manifestToServiceConfigs } from '@opentabs/plugin-loader';
import { __setRequestProvider, __registerPluginPermissions } from '@opentabs/plugin-sdk/server';
import { readFileSync } from 'node:fs';
import type {
  ServiceDefinition,
  ToolRegistrationFn,
  NativeApiPermission,
  PluginInstallPayload,
  StoredPluginManifest,
  StoredServiceDefinition,
  StoredServiceConfig,
  ResolvedPlugin,
  PluginLifecycleContext,
  PluginInstallContext,
  PluginUninstallContext,
  PluginEnableContext,
  PluginDisableContext,
  PluginSettingsChangeContext,
  LifecycleHookName,
} from '@opentabs/core';
import type { LoadPluginsResult } from '@opentabs/plugin-loader';
import type { RequestProvider } from '@opentabs/plugin-sdk/server';

// =============================================================================
// Types
// =============================================================================

/**
 * The result of initializing the plugin system. Contains everything the MCP
 * server needs to operate with plugins loaded.
 */
interface PluginInitResult {
  /** All successfully loaded plugins (manifests + tool registrations). */
  readonly loadResult: LoadPluginsResult;

  /** The merged tool registrations (platform-native + plugins). */
  readonly toolRegistrations: readonly ToolRegistrationFn[];

  /** Summary for logging. */
  readonly summary: PluginInitSummary;
}

/**
 * Human-readable summary of the plugin initialization, for logging and
 * health check responses.
 */
interface PluginInitSummary {
  /** Number of plugins successfully loaded. */
  readonly pluginsLoaded: number;

  /** Number of plugins that failed to load. */
  readonly pluginsFailed: number;

  /** Names of successfully loaded plugins. */
  readonly pluginNames: readonly string[];

  /** Names and errors of plugins that failed to load. */
  readonly failures: readonly { packageName: string; error: string }[];

  /** Total number of service definitions in the merged registry. */
  readonly totalServices: number;

  /** Total number of tool registration functions (platform + plugins). */
  readonly totalToolRegistrations: number;
}

// =============================================================================
// Request Provider Wiring
//
// The request provider is the abstraction layer between plugin tools and the
// MCP server's WebSocket relay. Plugin tools call sendServiceRequest() from
// the SDK, which delegates to the provider registered here.
//
// This function must be called BEFORE any tool handlers execute. It's called
// during server initialization with the relay instance.
// =============================================================================

/**
 * Wire the request provider so that plugin tools can communicate with browser
 * tab adapters via the WebSocket relay.
 *
 * This must be called once during server startup, before any MCP client
 * sessions are created. On hot reload, it's called again with the same relay
 * instance (the relay survives hot reloads via globalThis).
 *
 * @param provider - The request provider implementation (wraps the WebSocket relay)
 */
const wireRequestProvider = (provider: RequestProvider): void => {
  __setRequestProvider(provider);
};

// =============================================================================
// Lifecycle Hook Invocation
//
// Lifecycle hooks run in the MCP server process (Node/Bun) and have access
// to the same sendServiceRequest / sendBrowserRequest APIs as tool handlers.
// All hooks are optional and async. Failures in hooks are logged but never
// propagate — a broken hook must not prevent the platform operation from
// completing.
//
// The resolved plugins are cached after discovery so hooks can be invoked
// later (e.g. when the extension confirms an install or the user changes
// settings). Plugin code is already loaded in memory via dynamic import.
// =============================================================================

/** Cached resolved plugins from the most recent discovery. */
let resolvedPlugins: readonly ResolvedPlugin[] = [];

/** Get the cached resolved plugins. */
const getResolvedPlugins = (): readonly ResolvedPlugin[] => resolvedPlugins;

/** Find a resolved plugin by name. */
const findResolvedPlugin = (name: string): ResolvedPlugin | undefined =>
  resolvedPlugins.find(p => p.manifest.name === name);

/**
 * Safely invoke a lifecycle hook on a plugin. Catches and logs errors
 * so a broken hook never prevents the platform operation from completing.
 *
 * @param pluginName - The plugin name (for logging)
 * @param hookName - The hook name (for logging)
 * @param hookFn - The hook function to call (may be undefined)
 * @param context - The context to pass to the hook
 */
const invokeLifecycleHook = async <T extends PluginLifecycleContext>(
  pluginName: string,
  hookName: LifecycleHookName,
  hookFn: ((ctx: T) => Promise<void> | void) | undefined,
  context: T,
): Promise<void> => {
  if (!hookFn) return;

  try {
    await hookFn(context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[MCP] Lifecycle hook "${hookName}" for plugin "${pluginName}" threw an error: ${message}`);
  }
};

/**
 * Build the base lifecycle context shared by all hooks.
 */
const buildBaseContext = (plugin: ResolvedPlugin, settings?: Record<string, unknown>): PluginLifecycleContext => ({
  pluginName: plugin.manifest.name,
  pluginVersion: plugin.manifest.version,
  packagePath: plugin.packagePath,
  settings: settings ?? {},
});

/**
 * Invoke the `onInstall` hook for a plugin.
 *
 * Called after the extension confirms that a plugin was installed or upgraded.
 *
 * @param pluginName - The plugin name
 * @param reason - 'install' for first install, 'upgrade' for version change
 * @param previousVersion - The previous version string (for upgrades)
 * @param settings - Current user settings for the plugin
 */
const invokeOnInstall = async (
  pluginName: string,
  reason: 'install' | 'upgrade',
  previousVersion?: string,
  settings?: Record<string, unknown>,
): Promise<void> => {
  const plugin = findResolvedPlugin(pluginName);
  if (!plugin?.lifecycleHooks.onInstall) return;

  const context: PluginInstallContext = {
    ...buildBaseContext(plugin, settings),
    reason,
    previousVersion,
  };

  await invokeLifecycleHook(pluginName, 'onInstall', plugin.lifecycleHooks.onInstall, context);
};

/**
 * Invoke the `onUninstall` hook for a plugin.
 *
 * Called just before the extension removes a plugin's data. The hook runs
 * while the plugin is still loaded in memory, so it can perform cleanup.
 *
 * @param pluginName - The plugin name
 * @param settings - Current user settings for the plugin
 */
const invokeOnUninstall = async (pluginName: string, settings?: Record<string, unknown>): Promise<void> => {
  const plugin = findResolvedPlugin(pluginName);
  if (!plugin?.lifecycleHooks.onUninstall) return;

  const context: PluginUninstallContext = buildBaseContext(plugin, settings);

  await invokeLifecycleHook(pluginName, 'onUninstall', plugin.lifecycleHooks.onUninstall, context);
};

/**
 * Invoke the `onEnable` hook for a plugin.
 *
 * Called when a previously disabled plugin is re-enabled by the user.
 *
 * @param pluginName - The plugin name
 * @param settings - Current user settings for the plugin
 */
const invokeOnEnable = async (pluginName: string, settings?: Record<string, unknown>): Promise<void> => {
  const plugin = findResolvedPlugin(pluginName);
  if (!plugin?.lifecycleHooks.onEnable) return;

  const context: PluginEnableContext = buildBaseContext(plugin, settings);

  await invokeLifecycleHook(pluginName, 'onEnable', plugin.lifecycleHooks.onEnable, context);
};

/**
 * Invoke the `onDisable` hook for a plugin.
 *
 * Called when the user disables a plugin. The hook can clean up timers,
 * caches, or other resources that should not persist while inactive.
 *
 * @param pluginName - The plugin name
 * @param settings - Current user settings for the plugin
 */
const invokeOnDisable = async (pluginName: string, settings?: Record<string, unknown>): Promise<void> => {
  const plugin = findResolvedPlugin(pluginName);
  if (!plugin?.lifecycleHooks.onDisable) return;

  const context: PluginDisableContext = buildBaseContext(plugin, settings);

  await invokeLifecycleHook(pluginName, 'onDisable', plugin.lifecycleHooks.onDisable, context);
};

/**
 * Invoke the `onSettingsChange` hook for a plugin.
 *
 * Called when the user modifies any of the plugin's settings. The hook
 * receives both the previous and current settings, plus a list of which
 * keys changed, so it can react selectively.
 *
 * @param pluginName - The plugin name
 * @param currentSettings - The new settings values
 * @param previousSettings - The settings values before the change
 * @param changedKeys - Which settings keys were modified
 */
const invokeOnSettingsChange = async (
  pluginName: string,
  currentSettings: Record<string, unknown>,
  previousSettings: Record<string, unknown>,
  changedKeys: readonly string[],
): Promise<void> => {
  const plugin = findResolvedPlugin(pluginName);
  if (!plugin?.lifecycleHooks.onSettingsChange) return;

  const context: PluginSettingsChangeContext = {
    ...buildBaseContext(plugin, currentSettings),
    previousSettings,
    changedKeys,
  };

  await invokeLifecycleHook(pluginName, 'onSettingsChange', plugin.lifecycleHooks.onSettingsChange, context);
};

// =============================================================================
// Plugin Install Payloads — For Pushing to the Extension
//
// After discovering plugins, the MCP server builds PluginInstallPayload
// objects that contain everything the extension needs to dynamically
// install a plugin at runtime: the manifest, adapter IIFE code, service
// definitions, and service configs. These payloads are sent over WebSocket
// to the extension, which stores them in chrome.storage.local.
//
// The payloads are cached so they can be re-sent when the extension
// reconnects (e.g. after an extension reload or service worker restart).
// =============================================================================

/** Cached payloads from the most recent plugin discovery. */
let lastPluginPayloads: readonly PluginInstallPayload[] = [];

/**
 * Get the most recently built plugin install payloads. Used to re-sync
 * with the extension when it reconnects.
 */
const getLastPluginPayloads = (): readonly PluginInstallPayload[] => lastPluginPayloads;

/**
 * Build PluginInstallPayload objects from resolved plugins.
 *
 * Reads each plugin's compiled adapter IIFE from disk and packages it
 * with the manifest, service definitions, and service configs into a
 * payload the extension can store and activate at runtime.
 *
 * @param plugins - Resolved plugins from the plugin-loader
 * @returns Array of install payloads ready to send to the extension
 */
const buildPluginInstallPayloads = (plugins: readonly ResolvedPlugin[]): PluginInstallPayload[] => {
  const payloads: PluginInstallPayload[] = [];

  for (const plugin of plugins) {
    try {
      // Read the compiled adapter IIFE from disk
      const adapterCode = readFileSync(plugin.adapterPath, 'utf-8');

      // Convert the full manifest to the storable subset
      const manifest = pluginManifestToStored(plugin.manifest);

      // Build service definitions (JSON-serializable)
      const coreDef = manifestToServiceDefinition(plugin.manifest, plugin.manifest.name);
      const serviceDefinitions: StoredServiceDefinition[] = [
        {
          type: coreDef.type,
          displayName: coreDef.displayName,
          environments: [...coreDef.environments],
          domains: { ...coreDef.domains } as Record<string, string>,
          urlPatterns: Object.fromEntries(Object.entries(coreDef.urlPatterns).map(([k, v]) => [k, [...v]])) as Record<
            string,
            readonly string[]
          >,
          iconName: coreDef.iconName,
          timeout: coreDef.timeout,
          defaultUrl: coreDef.defaultUrl,
          hostPermissions: coreDef.hostPermissions ? [...coreDef.hostPermissions] : undefined,
          source: 'plugin',
          packageName: coreDef.packageName,
        },
      ];

      // Build service configs (JSON-serializable, no function refs)
      const coreConfigs = manifestToServiceConfigs(plugin.manifest, plugin.isHealthy);
      const serviceConfigs: Record<string, StoredServiceConfig> = {};

      for (const [serviceId, config] of Object.entries(coreConfigs)) {
        serviceConfigs[serviceId] = {
          serviceId: config.serviceId,
          displayName: config.displayName,
          adapterName: config.adapterName,
          urlPatterns: [...config.urlPatterns],
          domain: config.domain,
          authErrorPatterns: [...config.authErrorPatterns],
          healthCheck: {
            method: config.healthCheck.method,
            params: { ...config.healthCheck.params },
          },
          healthCheckEvaluator: plugin.manifest.service.healthCheck.evaluator,
          notConnectedMessage: config.notConnectedMessage,
          tabNotFoundMessage: config.tabNotFoundMessage,
        };
      }

      payloads.push({
        name: plugin.manifest.name,
        adapterCode,
        manifest,
        serviceDefinitions,
        serviceConfigs,
        version: plugin.manifest.version,
        trustTier: plugin.trustTier,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] Failed to build install payload for plugin "${plugin.manifest.name}": ${message}`);
    }
  }

  // Cache for re-sync on reconnect
  lastPluginPayloads = payloads;

  return payloads;
};

/**
 * Convert a full PluginManifest to the JSON-serializable StoredPluginManifest
 * subset that the extension stores in chrome.storage.local.
 */
const pluginManifestToStored = (manifest: ResolvedPlugin['manifest']): StoredPluginManifest => ({
  name: manifest.name,
  displayName: manifest.displayName,
  version: manifest.version,
  description: manifest.description,
  author: manifest.author,
  icon: manifest.icon,
  adapter: {
    domains: { ...manifest.adapter.domains },
    urlPatterns: Object.fromEntries(Object.entries(manifest.adapter.urlPatterns).map(([k, v]) => [k, [...v]])),
    hostPermissions: manifest.adapter.hostPermissions ? [...manifest.adapter.hostPermissions] : undefined,
    defaultUrl: manifest.adapter.defaultUrl,
  },
  service: {
    timeout: manifest.service.timeout,
    environments: [...manifest.service.environments],
    authErrorPatterns: [...manifest.service.authErrorPatterns],
    healthCheck: {
      method: manifest.service.healthCheck.method,
      params: { ...manifest.service.healthCheck.params },
      evaluator: manifest.service.healthCheck.evaluator,
    },
    notConnectedMessage: manifest.service.notConnectedMessage,
    tabNotFoundMessage: manifest.service.tabNotFoundMessage,
  },
  tools: {
    categories: manifest.tools.categories?.map(c => ({
      id: c.id,
      label: c.label,
      tools: c.tools ? [...c.tools] : undefined,
    })),
  },
  permissions: {
    network: [...manifest.permissions.network],
    storage: manifest.permissions.storage,
    nativeApis: manifest.permissions.nativeApis ? [...manifest.permissions.nativeApis] : undefined,
  },
});

// =============================================================================
// Plugin Initialization — Main Entry Point
// =============================================================================

/**
 * Initialize the plugin system: discover, validate, load, and wire all plugins.
 *
 * This is the main entry point called by server.ts during startup. It:
 *
 * 1. Discovers all installed plugins (node_modules scan + config file)
 * 2. Validates each plugin's opentabs-plugin.json manifest
 * 3. Dynamically imports each plugin's registerTools function
 * 4. Merges plugin service definitions into the global service registry
 * 5. Injects plugin tool registrations into the tools/index.ts module
 *
 * After this function returns, registerAllTools(server) will include both
 * platform-native tools and plugin tools.
 *
 * @param builtinDefinitions - Platform-native service definitions (can be empty
 *   if all services are plugins, or can include platform-managed services)
 * @param options - Optional overrides for the discovery process
 * @returns The initialization result with loaded plugins and summary
 *
 * @example
 * ```ts
 * // In server.ts startup:
 * const initResult = await initializePlugins([]);
 * console.log(`Loaded ${initResult.summary.pluginsLoaded} plugins`);
 *
 * // Now registerAllTools(server) includes plugin tools
 * const server = createServer();
 * ```
 */
const initializePlugins = async (
  builtinDefinitions: readonly ServiceDefinition[] = [],
  options?: {
    /** Root directory for plugin discovery. Default: process.cwd() */
    readonly rootDir?: string;
    /** Whether to log discovery progress. Default: true in development */
    readonly verbose?: boolean;
  },
): Promise<PluginInitResult> => {
  const verbose = options?.verbose ?? process.env.NODE_ENV !== 'production';

  if (verbose) {
    console.error('[MCP] Initializing plugin system...');
  }

  // 1. Run the full plugin loading pipeline
  //    This discovers, validates, loads modules, and merges into the registry.
  //    Built-in tool registrations are passed as empty — they're handled
  //    separately in tools/index.ts via PLATFORM_REGISTRATIONS.
  const loadResult = await loadPlugins(
    builtinDefinitions,
    [], // Built-in tool registrations are managed by tools/index.ts
    {
      rootDir: options?.rootDir,
      verbose,
    },
  );

  // 2. Register runtime permissions for each plugin (nativeApis enforcement)
  for (const plugin of loadResult.plugins) {
    const nativeApis = plugin.manifest.permissions.nativeApis ?? [];
    __registerPluginPermissions(plugin.manifest.name, nativeApis as readonly NativeApiPermission[]);
  }

  // 3. Extract plugin tool registrations and inject into tools/index.ts
  const pluginToolRegistrations = loadResult.plugins.map(p => p.registerTools as ToolRegistrationFn);
  setPluginRegistrations(pluginToolRegistrations);

  // 4. Cache resolved plugins for lifecycle hook invocation
  resolvedPlugins = loadResult.plugins;

  // 5. Build install payloads for the extension (adapter code + configs)
  //    These are cached and sent to the extension over WebSocket when it connects.
  buildPluginInstallPayloads(loadResult.plugins);

  // 6. Build summary
  const summary: PluginInitSummary = {
    pluginsLoaded: loadResult.plugins.length,
    pluginsFailed: loadResult.failures.length,
    pluginNames: loadResult.plugins.map(p => p.manifest.name),
    failures: loadResult.failures.map(f => ({
      packageName: f.packageName,
      error: f.error,
    })),
    totalServices: loadResult.registry.length,
    totalToolRegistrations: loadResult.toolRegistrations.length,
  };

  // 7. Log summary
  if (verbose) {
    if (summary.pluginsLoaded > 0) {
      console.error(
        `[MCP] Plugin system initialized: ${summary.pluginsLoaded} plugin(s) loaded ` +
          `(${summary.pluginNames.join(', ')})`,
      );
    } else {
      console.error('[MCP] Plugin system initialized: no plugins found');
    }

    if (summary.pluginsFailed > 0) {
      console.error(`[MCP] ${summary.pluginsFailed} plugin(s) failed to load:`);
      for (const failure of summary.failures) {
        console.error(`[MCP]   - ${failure.packageName}: ${failure.error}`);
      }
    }
  }

  return {
    loadResult,
    toolRegistrations: loadResult.toolRegistrations,
    summary,
  };
};

// =============================================================================
// Re-initialization for Hot Reload
//
// On hot reload (bun --hot), all modules re-evaluate. The plugin-loader
// re-discovers plugins (potentially picking up new ones or changes to
// existing ones). This function is a lighter-weight version of
// initializePlugins() that skips registry setup (the registry is already
// frozen from the initial load) and only refreshes tool registrations.
//
// Uses `skipRegistryMerge: true` to avoid hitting the "registry is frozen"
// guard in setServiceRegistry(). The registry contents don't change during
// hot reload — only tool handler code is refreshed.
// =============================================================================

/**
 * Refresh plugin tool registrations without re-initializing the service
 * registry. Used during hot reload when the registry is already frozen.
 *
 * This re-discovers plugins, re-imports their tool modules (picking up code
 * changes), and updates the tool registration pipeline. The service registry
 * is NOT modified — it was frozen during initial startup and remains unchanged.
 *
 * @param options - Optional overrides for the discovery process
 * @returns Summary of what was refreshed
 */
const refreshPluginTools = async (options?: {
  readonly rootDir?: string;
  readonly verbose?: boolean;
}): Promise<PluginInitSummary> => {
  const verbose = options?.verbose ?? false;

  if (verbose) {
    console.error('[MCP] Refreshing plugin tools for hot reload...');
  }

  // Re-discover and re-load plugin modules with skipRegistryMerge to avoid
  // hitting the frozen registry guard. Tool modules are re-imported fresh,
  // picking up any code changes.
  const loadResult = await loadPlugins([], [], {
    rootDir: options?.rootDir,
    verbose,
    skipRegistryMerge: true,
  });

  // Re-register runtime permissions (plugin manifests may have changed)
  for (const plugin of loadResult.plugins) {
    const nativeApis = plugin.manifest.permissions.nativeApis ?? [];
    __registerPluginPermissions(plugin.manifest.name, nativeApis as readonly NativeApiPermission[]);
  }

  // Update tool registrations
  const pluginToolRegistrations = loadResult.plugins.map(p => p.registerTools as ToolRegistrationFn);
  setPluginRegistrations(pluginToolRegistrations);

  // Cache resolved plugins and rebuild install payloads for the extension
  resolvedPlugins = loadResult.plugins;
  buildPluginInstallPayloads(loadResult.plugins);

  const summary: PluginInitSummary = {
    pluginsLoaded: loadResult.plugins.length,
    pluginsFailed: loadResult.failures.length,
    pluginNames: loadResult.plugins.map(p => p.manifest.name),
    failures: loadResult.failures.map(f => ({
      packageName: f.packageName,
      error: f.error,
    })),
    totalServices: loadResult.registry.length,
    totalToolRegistrations: loadResult.toolRegistrations.length,
  };

  if (verbose) {
    console.error(`[MCP] Plugin tools refreshed: ${summary.pluginsLoaded} plugin(s)`);
  }

  return summary;
};

// =============================================================================
// Exports
// =============================================================================

export type { PluginInitResult, PluginInitSummary };

export {
  wireRequestProvider,
  getResolvedPlugins,
  invokeOnInstall,
  invokeOnUninstall,
  invokeOnEnable,
  invokeOnDisable,
  invokeOnSettingsChange,
  getLastPluginPayloads,
  buildPluginInstallPayloads,
  initializePlugins,
  refreshPluginTools,
};
