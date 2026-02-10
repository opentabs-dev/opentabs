/**
 * Plugin Manager — High-Level Plugin Lifecycle Orchestration
 *
 * Coordinates plugin-store (persistence), adapter-manager (injection),
 * service registry (routing), and service controllers (tab lifecycle)
 * to provide atomic install/uninstall/enable/disable operations.
 *
 * When the MCP server discovers a plugin, it sends a PluginInstallPayload
 * over WebSocket. This module handles that payload by:
 *
 *   1. Persisting the plugin data to chrome.storage.local (via plugin-store)
 *   2. Adding service definitions to the dynamic service registry
 *   3. Creating WebappServiceControllers for the plugin's service IDs
 *   4. Injecting the adapter into any currently open matching tabs
 *   5. Triggering a status broadcast so the side panel updates
 *
 * Uninstall reverses all of these steps. Enable/disable toggles adapter
 * injection and service controller activity without removing stored data.
 *
 * This module owns the `managers` record (serviceId → ServiceManager) and
 * the `connectionStatus` object. It exposes them to the background script's
 * composition root for use in message routing, alarms, and badge updates.
 */

import {
  injectAdapterIntoMatchingTabs,
  clearPlugin,
  injectAdaptersOnStartup,
  handleTabLoadComplete as adapterHandleTabLoadComplete,
  handleTabRemoved as adapterHandleTabRemoved,
  dispatchToAdapter,
} from './adapter-manager.js';
import {
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  getAllPlugins,
  syncPlugins,
  getPlugin,
  getPluginStatuses,
} from './plugin-store.js';
import { WebappServiceController } from './service-controllers/index.js';
import { addServiceDefinitions, removeServiceDefinitions, setServiceRegistry, Defaults } from '@opentabs/core';
import type { ServiceManager, ServiceManagerContext } from './service-managers/types.js';
import type {
  ConnectionStatus,
  ServiceDefinition,
  WebappServiceConfig,
  StoredPluginData,
  StoredServiceConfig,
  StoredServiceDefinition,
  PluginInstallPayload,
  PluginInstallResult,
  PluginUninstallResult,
  InstalledPluginStatus,
} from '@opentabs/core';

// =============================================================================
// Shared State
//
// The plugin manager owns the managers record and connection status.
// These are exported so that the background script's composition root can
// pass them to the MCP router, alarm handlers, and badge updater.
// =============================================================================

/** Per-service controllers, keyed by service ID. */
let managers: Record<string, ServiceManager> = {};

/** Overall platform connection status. */
let connectionStatus: ConnectionStatus = {
  mcpConnected: false,
  port: Defaults.WS_PORT,
  serverPath: undefined,
  services: {},
};

/** Service manager context — injected dependencies for controllers. */
let serviceManagerCtx: ServiceManagerContext | null = null;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the plugin manager with shared dependencies and restore
 * previously installed plugins from chrome.storage.local.
 *
 * Called once during the background script's startup sequence. After this
 * returns, `getManagers()` and `getConnectionStatus()` are populated with
 * data from all installed plugins.
 *
 * @param ctx - The service manager context (provides sendViaWebSocket, etc.)
 * @param restoredPort - The WebSocket port restored from storage
 */
const initializePluginManager = async (ctx: ServiceManagerContext, restoredPort?: number): Promise<void> => {
  serviceManagerCtx = ctx;

  connectionStatus = {
    mcpConnected: false,
    port: restoredPort ?? Defaults.WS_PORT,
    serverPath: undefined,
    services: {},
  };

  managers = {};

  // Load all installed plugins from storage and create controllers
  const plugins = await getAllPlugins();
  const allDefinitions: ServiceDefinition[] = [];

  for (const plugin of Object.values(plugins)) {
    if (!plugin.enabled) continue;

    const definitions = storedDefinitionsToServiceDefinitions(plugin.serviceDefinitions);
    allDefinitions.push(...definitions);

    const configs = storedConfigsToWebappConfigs(plugin.serviceConfigs);
    for (const [serviceId, config] of Object.entries(configs)) {
      createController(serviceId, config);
    }
  }

  // Populate the service registry with all enabled plugins' definitions
  setServiceRegistry(allDefinitions);

  // Inject adapters into any existing matching tabs
  await injectAdaptersOnStartup();

  const pluginCount = Object.keys(plugins).length;
  const enabledCount = Object.values(plugins).filter(p => p.enabled).length;
  console.log(
    `[OpenTabs] Plugin manager initialized: ${pluginCount} plugin(s), ${enabledCount} enabled, ` +
      `${Object.keys(managers).length} service controller(s)`,
  );
};

// =============================================================================
// Accessors
// =============================================================================

/** Get the current managers record. */
const getManagers = (): Record<string, ServiceManager> => managers;

/** Get the current connection status. */
const getConnectionStatus = (): ConnectionStatus => connectionStatus;

// =============================================================================
// Plugin Install
// =============================================================================

/**
 * Install or update a plugin from an MCP server payload.
 *
 * Performs the full installation sequence:
 *   1. Persist to storage
 *   2. Add service definitions to registry
 *   3. Create service controllers
 *   4. Initialize connection status entries
 *   5. Inject adapter into matching tabs
 *   6. Start tab discovery for the new service
 *
 * Safe to call multiple times for the same plugin (upgrade path).
 *
 * @param payload - The plugin install payload from the MCP server
 * @returns The install result with success/failure status
 */
const handlePluginInstall = async (payload: PluginInstallPayload): Promise<PluginInstallResult> => {
  if (!serviceManagerCtx) {
    return {
      success: false,
      name: payload.name,
      version: payload.version,
      reason: 'install',
      error: 'Plugin manager not initialized',
    };
  }

  try {
    // 1. Check if this is an upgrade (plugin already installed)
    const existing = await getPlugin(payload.name);
    const isUpgrade = existing !== undefined;

    // If upgrading, tear down existing controllers first
    if (isUpgrade) {
      removePluginControllers(payload.name, existing);
    }

    // 2. Persist to storage
    const { reason, previousVersion } = await installPlugin(payload);

    // 3. Add service definitions to the registry
    const definitions = storedDefinitionsToServiceDefinitions(payload.serviceDefinitions);
    try {
      addServiceDefinitions(definitions);
    } catch {
      // Definitions may already exist if this is a rapid re-install.
      // Remove and re-add.
      const types = definitions.map(d => d.type);
      removeServiceDefinitions(types);
      addServiceDefinitions(definitions);
    }

    // 4. Create service controllers and connection status entries
    const configs = storedConfigsToWebappConfigs(payload.serviceConfigs);
    for (const [serviceId, config] of Object.entries(configs)) {
      connectionStatus.services[serviceId] = { connected: false };
      createController(serviceId, config);
    }

    // 5. Inject adapter into matching tabs
    const pluginData = await getPlugin(payload.name);
    if (pluginData) {
      const tabCount = await injectAdapterIntoMatchingTabs(pluginData);
      if (tabCount > 0) {
        console.log(`[OpenTabs] Injected "${payload.name}" adapter into ${tabCount} tab(s)`);
      }
    }

    // 6. Start tab discovery for new service controllers
    for (const [serviceId] of Object.entries(configs)) {
      const manager = managers[serviceId];
      if (manager) {
        await manager.findTabs();
      }
    }

    console.log(
      `[OpenTabs] Plugin "${payload.name}" ${reason === 'upgrade' ? 'upgraded' : 'installed'} ` +
        `(v${payload.version}${previousVersion ? ` from v${previousVersion}` : ''})`,
    );

    return {
      success: true,
      name: payload.name,
      version: payload.version,
      reason,
      previousVersion,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[OpenTabs] Failed to install plugin "${payload.name}":`, message);

    return {
      success: false,
      name: payload.name,
      version: payload.version,
      reason: 'install',
      error: message,
    };
  }
};

// =============================================================================
// Plugin Uninstall
// =============================================================================

/**
 * Uninstall a plugin completely.
 *
 * Reverses the install sequence:
 *   1. Disconnect and destroy service controllers
 *   2. Remove service definitions from registry
 *   3. Clear adapter injection tracking
 *   4. Remove connection status entries
 *   5. Remove from storage
 *
 * @param name - The plugin name to uninstall
 * @returns The uninstall result
 */
const handlePluginUninstall = async (name: string): Promise<PluginUninstallResult> => {
  try {
    const plugin = await getPlugin(name);
    if (!plugin) {
      return { success: false, name, error: `Plugin "${name}" is not installed` };
    }

    // 1-4. Remove controllers, definitions, tracking, and status
    removePluginControllers(name, plugin);

    // 5. Remove from storage
    await uninstallPlugin(name);

    console.log(`[OpenTabs] Plugin "${name}" uninstalled`);

    return { success: true, name };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[OpenTabs] Failed to uninstall plugin "${name}":`, message);
    return { success: false, name, error: message };
  }
};

// =============================================================================
// Plugin Enable / Disable
// =============================================================================

/**
 * Enable a previously disabled plugin.
 *
 * Re-creates service controllers, re-adds service definitions to the
 * registry, and injects the adapter into matching tabs.
 *
 * @param name - The plugin name to enable
 * @returns true if the plugin was found and enabled
 */
const handlePluginEnable = async (name: string): Promise<boolean> => {
  if (!serviceManagerCtx) return false;

  const plugin = await getPlugin(name);
  if (!plugin) return false;

  if (plugin.enabled) return true; // Already enabled

  // Update storage
  const updated = await setPluginEnabled(name, true);
  if (!updated) return false;

  // Add service definitions
  const definitions = storedDefinitionsToServiceDefinitions(plugin.serviceDefinitions);
  try {
    addServiceDefinitions(definitions);
  } catch {
    // May already exist — idempotent recovery
    const types = definitions.map(d => d.type);
    removeServiceDefinitions(types);
    addServiceDefinitions(definitions);
  }

  // Create controllers
  const configs = storedConfigsToWebappConfigs(plugin.serviceConfigs);
  for (const [serviceId, config] of Object.entries(configs)) {
    connectionStatus.services[serviceId] = { connected: false };
    createController(serviceId, config);
  }

  // Inject adapters and find tabs
  const reloaded = await getPlugin(name);
  if (reloaded) {
    await injectAdapterIntoMatchingTabs(reloaded);
  }

  for (const [serviceId] of Object.entries(configs)) {
    const manager = managers[serviceId];
    if (manager) {
      await manager.findTabs();
    }
  }

  console.log(`[OpenTabs] Plugin "${name}" enabled`);
  return true;
};

/**
 * Disable a plugin without uninstalling it.
 *
 * Destroys service controllers, removes service definitions from the
 * registry, and clears adapter injection tracking. The plugin's data
 * remains in storage and can be re-enabled later.
 *
 * @param name - The plugin name to disable
 * @returns true if the plugin was found and disabled
 */
const handlePluginDisable = async (name: string): Promise<boolean> => {
  const plugin = await getPlugin(name);
  if (!plugin) return false;

  if (!plugin.enabled) return true; // Already disabled

  // Tear down controllers and registry entries
  removePluginControllers(name, plugin);

  // Update storage
  await setPluginEnabled(name, false);

  console.log(`[OpenTabs] Plugin "${name}" disabled`);
  return true;
};

// =============================================================================
// Plugin Sync — Bulk Install from MCP Server
// =============================================================================

/**
 * Sync the extension's plugin set with the MCP server's discovered plugins.
 *
 * Called when the MCP server connects (or reconnects) to the extension.
 * The server sends all its discovered plugins as install payloads. This
 * function reconciles the extension's stored plugins with the server's
 * set: installs new ones, upgrades changed ones, and removes ones that
 * are no longer discovered by the server.
 *
 * @param payloads - All plugin install payloads from the MCP server
 * @returns Summary of sync operations
 */
const handlePluginSync = async (
  payloads: readonly PluginInstallPayload[],
): Promise<{
  installed: string[];
  upgraded: string[];
  removed: string[];
  unchanged: string[];
}> => {
  // Use the store's bulk sync
  const result = await syncPlugins(payloads);

  // Tear down controllers for removed plugins
  for (const name of result.removed) {
    // Plugin is already removed from storage by syncPlugins, but we
    // may still have controllers running. Get service types from the
    // current managers to find and remove them.
    const serviceIdsToRemove: string[] = [];

    for (const [serviceId, manager] of Object.entries(managers)) {
      // Convention: service ID starts with plugin name or equals it
      if (serviceIdBelongsToPlugin(serviceId, name)) {
        if (manager.isConnected()) {
          await manager.handleDisconnect();
        }
        serviceIdsToRemove.push(serviceId);
      }
    }

    for (const serviceId of serviceIdsToRemove) {
      delete managers[serviceId];
      delete connectionStatus.services[serviceId];
    }

    if (serviceIdsToRemove.length > 0) {
      removeServiceDefinitions(serviceIdsToRemove);
    }

    clearPlugin(name);
  }

  // Rebuild registry and controllers from the synced state
  // (This handles installs, upgrades, and preserves unchanged)
  if (result.installed.length > 0 || result.upgraded.length > 0) {
    const plugins = await getAllPlugins();
    const allDefinitions: ServiceDefinition[] = [];

    // Rebuild the full registry from all enabled plugins
    for (const plugin of Object.values(plugins)) {
      if (!plugin.enabled) continue;
      const defs = storedDefinitionsToServiceDefinitions(plugin.serviceDefinitions);
      allDefinitions.push(...defs);
    }

    // Reset and repopulate the service registry
    setServiceRegistry(allDefinitions);

    // Create controllers for new/upgraded plugins
    for (const name of [...result.installed, ...result.upgraded]) {
      const plugin = plugins[name];
      if (!plugin || !plugin.enabled) continue;

      const configs = storedConfigsToWebappConfigs(plugin.serviceConfigs);
      for (const [serviceId, config] of Object.entries(configs)) {
        // Remove old controller if it exists (upgrade path)
        delete managers[serviceId];
        connectionStatus.services[serviceId] = { connected: false };
        createController(serviceId, config);
      }

      // Inject adapter
      await injectAdapterIntoMatchingTabs(plugin);

      // Find tabs
      for (const serviceId of Object.keys(configs)) {
        const manager = managers[serviceId];
        if (manager) {
          await manager.findTabs();
        }
      }
    }
  }

  if (result.installed.length > 0 || result.upgraded.length > 0 || result.removed.length > 0) {
    console.log(
      `[OpenTabs] Plugin sync: ${result.installed.length} installed, ` +
        `${result.upgraded.length} upgraded, ${result.removed.length} removed, ` +
        `${result.unchanged.length} unchanged`,
    );
  }

  return result;
};

// =============================================================================
// Plugin List
// =============================================================================

/**
 * Get the status of all installed plugins.
 * Used by the side panel and options page.
 */
const listPlugins = async (): Promise<InstalledPluginStatus[]> => getPluginStatuses();

// =============================================================================
// Tab Event Forwarding
//
// These functions handle tab events by delegating to both the adapter
// manager (for dynamic injection) and the service controllers (for tab
// lifecycle). The background script's composition root wires these into
// chrome.tabs.onUpdated and chrome.tabs.onRemoved.
// =============================================================================

/**
 * Handle a tab finishing its load. Injects matching adapters and notifies
 * service controllers.
 */
const handleTabLoadComplete = async (tabId: number, url: string): Promise<void> => {
  // Inject adapters for matching plugins
  await adapterHandleTabLoadComplete(tabId, url);

  // Notify service controllers
  for (const manager of Object.values(managers)) {
    manager.handleTabLoadComplete(tabId, url);
  }
};

/**
 * Handle a tab being closed. Cleans up adapter tracking and notifies
 * service controllers.
 */
const handleTabRemoved = (tabId: number): void => {
  adapterHandleTabRemoved(tabId);

  for (const [serviceId, manager] of Object.entries(managers)) {
    if (tabId === manager.getTabId()) {
      console.log(`[OpenTabs] ${serviceId} tab closed`);
      manager.handleDisconnect(tabId);
    }
  }
};

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Create a WebappServiceController and register it in the managers record.
 */
const createController = (serviceId: string, config: WebappServiceConfig): void => {
  if (!serviceManagerCtx) {
    console.error(`[OpenTabs] Cannot create controller for "${serviceId}": plugin manager not initialized`);
    return;
  }

  managers[serviceId] = new WebappServiceController(connectionStatus, serviceManagerCtx, config);
};

/**
 * Remove all controllers, service definitions, and connection status
 * entries for a plugin. Used during uninstall and disable.
 */
const removePluginControllers = (pluginName: string, plugin: StoredPluginData): void => {
  const serviceTypes: string[] = [];

  // Identify service IDs from the plugin's service configs
  for (const serviceId of Object.keys(plugin.serviceConfigs)) {
    const manager = managers[serviceId];

    // Disconnect the controller if it's connected
    if (manager?.isConnected()) {
      manager.handleDisconnect();
    }

    delete managers[serviceId];
    delete connectionStatus.services[serviceId];
    serviceTypes.push(serviceId);
  }

  // Remove service definitions from the registry
  const definitionTypes = plugin.serviceDefinitions.map(d => d.type);
  removeServiceDefinitions(definitionTypes);

  // Clear adapter injection tracking
  clearPlugin(pluginName);
};

/**
 * Check if a service ID belongs to a plugin.
 *
 * For single-env plugins, serviceId === pluginName (e.g. 'slack').
 * For multi-env plugins, serviceId is `${pluginName}_${env}` (e.g. 'datadog_production').
 */
const serviceIdBelongsToPlugin = (serviceId: string, pluginName: string): boolean =>
  serviceId === pluginName || serviceId.startsWith(`${pluginName}_`);

/**
 * Convert stored service definitions (JSON-serializable) to the
 * ServiceDefinition type used by the registry.
 */
const storedDefinitionsToServiceDefinitions = (stored: readonly StoredServiceDefinition[]): ServiceDefinition[] =>
  stored.map(def => ({
    type: def.type,
    displayName: def.displayName,
    environments: def.environments as readonly ('production' | 'staging')[],
    domains: def.domains as Readonly<Record<string, string>>,
    urlPatterns: def.urlPatterns as Readonly<Record<string, readonly string[]>>,
    iconName: def.iconName,
    timeout: def.timeout,
    defaultUrl: def.defaultUrl,
    hostPermissions: def.hostPermissions,
    source: def.source,
    packageName: def.packageName,
  }));

/**
 * Convert stored service configs (JSON-serializable) to the
 * WebappServiceConfig type used by controllers.
 *
 * The `isHealthy` function reference cannot be stored in JSON. For stored
 * configs, the health check evaluator is identified by the
 * `healthCheckEvaluator` string field. At runtime, the default evaluator
 * (!isJsonRpcError) is used. Custom evaluators from plugin code are only
 * available on the MCP server side where the plugin module is imported.
 *
 * On the extension side, the health check evaluator is intentionally
 * simplified: a non-error JSON-RPC response is considered healthy. The
 * MCP server handles the full evaluator resolution via plugin module
 * imports. This trade-off keeps the extension lightweight and avoids
 * executing arbitrary plugin code in the service worker.
 */
const storedConfigsToWebappConfigs = (
  stored: Record<string, StoredServiceConfig>,
): Record<string, WebappServiceConfig> => {
  const configs: Record<string, WebappServiceConfig> = {};

  for (const [serviceId, sc] of Object.entries(stored)) {
    configs[serviceId] = {
      serviceId: sc.serviceId,
      displayName: sc.displayName,
      adapterName: sc.adapterName,
      urlPatterns: [...sc.urlPatterns],
      domain: sc.domain,
      authErrorPatterns: [...sc.authErrorPatterns],
      healthCheck: {
        method: sc.healthCheck.method,
        params: { ...sc.healthCheck.params },
      },
      // isHealthy is not available from storage — use default evaluator
      notConnectedMessage: sc.notConnectedMessage,
      tabNotFoundMessage: sc.tabNotFoundMessage,
    };
  }

  return configs;
};

// =============================================================================
// Exports
// =============================================================================

export {
  // Initialization
  initializePluginManager,
  // Accessors
  getManagers,
  getConnectionStatus,
  // Plugin operations
  handlePluginInstall,
  handlePluginUninstall,
  handlePluginEnable,
  handlePluginDisable,
  handlePluginSync,
  listPlugins,
  // Tab forwarding
  handleTabLoadComplete,
  handleTabRemoved,
  // Re-export dispatch for convenience
  dispatchToAdapter,
};
