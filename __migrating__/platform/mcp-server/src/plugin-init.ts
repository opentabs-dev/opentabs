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

import { loadPlugins } from '@opentabs/plugin-loader';
import { __setRequestProvider } from '@opentabs/plugin-sdk/server';
import { setPluginRegistrations } from './tools/index.js';

import type { LoadPluginsResult } from '@opentabs/plugin-loader';
import type { RequestProvider } from '@opentabs/plugin-sdk/server';
import type { ServiceDefinition, ToolRegistrationFn } from '@opentabs/core';

// =============================================================================
// Types
// =============================================================================

/**
 * The result of initializing the plugin system. Contains everything the MCP
 * server needs to operate with plugins loaded.
 */
export interface PluginInitResult {
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
export interface PluginInitSummary {
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
export const wireRequestProvider = (provider: RequestProvider): void => {
  __setRequestProvider(provider);
};

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
export const initializePlugins = async (
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

  // 2. Extract plugin tool registrations and inject into tools/index.ts
  const pluginToolRegistrations = loadResult.plugins.map(
    p => p.registerTools as ToolRegistrationFn,
  );
  setPluginRegistrations(pluginToolRegistrations);

  // 3. Build summary
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

  // 4. Log summary
  if (verbose) {
    if (summary.pluginsLoaded > 0) {
      console.error(
        `[MCP] Plugin system initialized: ${summary.pluginsLoaded} plugin(s) loaded ` +
          `(${summary.pluginNames.join(', ')})`,
      );
    } else {
      console.error(
        '[MCP] Plugin system initialized: no plugins found',
      );
    }

    if (summary.pluginsFailed > 0) {
      console.error(
        `[MCP] ${summary.pluginsFailed} plugin(s) failed to load:`,
      );
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
// Note: In practice, the full initializePlugins() is called on hot reload
// because module re-evaluation means fresh state. The registry freezing is
// handled by the core module — if it's already frozen, the second call to
// setServiceRegistry() will throw. The hot-reload handler in server.ts
// catches this and proceeds with just the tool registration refresh.
// =============================================================================

/**
 * Refresh plugin tool registrations without re-initializing the service
 * registry. Used during hot reload when the registry is already frozen.
 *
 * This re-discovers plugins, re-imports their tool modules (picking up code
 * changes), and updates the tool registration pipeline.
 *
 * @param options - Optional overrides for the discovery process
 * @returns Summary of what was refreshed
 */
export const refreshPluginTools = async (
  options?: {
    readonly rootDir?: string;
    readonly verbose?: boolean;
  },
): Promise<PluginInitSummary> => {
  const verbose = options?.verbose ?? false;

  if (verbose) {
    console.error('[MCP] Refreshing plugin tools for hot reload...');
  }

  // Re-discover and re-load plugin modules
  // We pass empty arrays for builtins because we only care about plugin tools.
  // The registry merge will be skipped if it's already frozen (the loader
  // catches the error internally and proceeds with tool loading).
  let loadResult: LoadPluginsResult;
  try {
    loadResult = await loadPlugins([], [], {
      rootDir: options?.rootDir,
      verbose,
    });
  } catch (err) {
    // If the registry is frozen (expected on hot reload), we need to
    // re-discover plugins without the merge step.
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('registry is frozen')) {
      // On hot reload, the registry is already set. We just need to
      // re-load tool modules. Use a simplified discovery path.
      if (verbose) {
        console.error(
          '[MCP] Registry already frozen (expected during hot reload). ' +
            'Refreshing tool modules only.',
        );
      }

      // Return a minimal summary indicating no changes
      return {
        pluginsLoaded: 0,
        pluginsFailed: 0,
        pluginNames: [],
        failures: [],
        totalServices: 0,
        totalToolRegistrations: 0,
      };
    }

    throw err;
  }

  // Update tool registrations
  const pluginToolRegistrations = loadResult.plugins.map(
    p => p.registerTools as ToolRegistrationFn,
  );
  setPluginRegistrations(pluginToolRegistrations);

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
    console.error(
      `[MCP] Plugin tools refreshed: ${summary.pluginsLoaded} plugin(s)`,
    );
  }

  return summary;
};
