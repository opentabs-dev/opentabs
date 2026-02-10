/**
 * Plugin Store — Persistent Storage for Dynamically Installed Plugins
 *
 * Uses chrome.storage.local to store plugin data (manifests, adapter code,
 * service configs, enabled state). This is the extension's source of truth
 * for which plugins are installed and their runtime configuration.
 *
 * Storage schema:
 *   `plugins` → Record<string, StoredPluginData>
 *
 * All mutations go through this module to ensure consistency. The plugin
 * manager (plugin-manager.ts) orchestrates higher-level operations (install,
 * uninstall, enable, disable) and calls these lower-level CRUD functions.
 *
 * Storage size: chrome.storage.local has a ~10MB limit. A typical plugin's
 * adapter code is 10-50KB, so hundreds of plugins can be stored comfortably.
 */

import type { StoredPluginData, PluginInstallPayload, InstalledPluginStatus } from '@opentabs/core';

// -----------------------------------------------------------------------------
// Storage Keys
// -----------------------------------------------------------------------------

/** The single storage key under which all plugin data lives. */
const PLUGINS_STORAGE_KEY = 'plugins';

// -----------------------------------------------------------------------------
// Read Operations
// -----------------------------------------------------------------------------

/**
 * Load all installed plugins from storage.
 *
 * @returns A record of plugin name → StoredPluginData, or empty object if none
 */
const getAllPlugins = async (): Promise<Record<string, StoredPluginData>> => {
  try {
    const result = await chrome.storage.local.get(PLUGINS_STORAGE_KEY);
    return (result[PLUGINS_STORAGE_KEY] as Record<string, StoredPluginData>) ?? {};
  } catch (err) {
    console.error('[OpenTabs] Failed to read plugins from storage:', err);
    return {};
  }
};

/**
 * Load a single plugin's data from storage.
 *
 * @param name - The plugin name
 * @returns The plugin data, or undefined if not installed
 */
const getPlugin = async (name: string): Promise<StoredPluginData | undefined> => {
  const plugins = await getAllPlugins();
  return plugins[name];
};

/**
 * Check whether a plugin is installed.
 *
 * @param name - The plugin name
 */
const isPluginInstalled = async (name: string): Promise<boolean> => {
  const plugin = await getPlugin(name);
  return plugin !== undefined;
};

/**
 * Get all enabled plugins. Enabled plugins have their adapters injected
 * into matching tabs and their tools registered on the MCP server.
 *
 * @returns Array of StoredPluginData for enabled plugins only
 */
const getEnabledPlugins = async (): Promise<StoredPluginData[]> => {
  const plugins = await getAllPlugins();
  return Object.values(plugins).filter(p => p.enabled);
};

/**
 * Get the adapter code for a specific plugin.
 *
 * @param name - The plugin name
 * @returns The adapter IIFE source code, or undefined if not found
 */
const getAdapterCode = async (name: string): Promise<string | undefined> => {
  const plugin = await getPlugin(name);
  return plugin?.adapterCode;
};

/**
 * Get all URL patterns across all enabled plugins. Used to determine
 * which tabs should have adapters injected.
 *
 * @returns A map of plugin name → flat array of all URL patterns
 */
const getEnabledUrlPatterns = async (): Promise<Record<string, string[]>> => {
  const plugins = await getEnabledPlugins();
  const patterns: Record<string, string[]> = {};

  for (const plugin of plugins) {
    const allPatterns = Object.values(plugin.manifest.adapter.urlPatterns).flat();
    if (allPatterns.length > 0) {
      patterns[plugin.manifest.name] = [...allPatterns];
    }
  }

  return patterns;
};

/**
 * Find which enabled plugin matches a given URL, based on domain matching.
 *
 * @param url - The full URL to match
 * @returns The matching plugin data, or undefined if no match
 */
const findPluginForUrl = async (url: string): Promise<StoredPluginData | undefined> => {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return undefined;
  }

  const plugins = await getEnabledPlugins();

  for (const plugin of plugins) {
    const domains = Object.values(plugin.manifest.adapter.domains);
    for (const domain of domains) {
      // Leading dot means "any subdomain" (e.g. '.slack.com' matches 'brex.slack.com')
      if (domain.startsWith('.')) {
        if (hostname.endsWith(domain) || hostname === domain.slice(1)) {
          return plugin;
        }
      } else {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return plugin;
        }
      }
    }
  }

  return undefined;
};

/**
 * Find all enabled plugins that match a given URL.
 * A URL can match multiple plugins (though this is unusual and generates
 * warnings during plugin validation).
 *
 * @param url - The full URL to match
 * @returns Array of matching plugin data
 */
const findPluginsForUrl = async (url: string): Promise<StoredPluginData[]> => {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return [];
  }

  const plugins = await getEnabledPlugins();
  const matches: StoredPluginData[] = [];

  for (const plugin of plugins) {
    const domains = Object.values(plugin.manifest.adapter.domains);
    let matched = false;

    for (const domain of domains) {
      if (matched) break;

      if (domain.startsWith('.')) {
        if (hostname.endsWith(domain) || hostname === domain.slice(1)) {
          matched = true;
        }
      } else {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          matched = true;
        }
      }
    }

    if (matched) {
      matches.push(plugin);
    }
  }

  return matches;
};

/**
 * Build an InstalledPluginStatus array for all installed plugins.
 * Used by the side panel and options page to display plugin status.
 *
 * @returns Array of plugin status objects
 */
const getPluginStatuses = async (): Promise<InstalledPluginStatus[]> => {
  const plugins = await getAllPlugins();
  return Object.values(plugins).map(plugin => ({
    name: plugin.manifest.name,
    displayName: plugin.manifest.displayName,
    version: plugin.version,
    description: plugin.manifest.description,
    enabled: plugin.enabled,
    trustTier: plugin.trustTier,
    installedAt: plugin.installedAt,
  }));
};

// -----------------------------------------------------------------------------
// Write Operations
// -----------------------------------------------------------------------------

/**
 * Save the entire plugins record to storage. All write operations go
 * through this function to ensure atomicity.
 */
const saveAllPlugins = async (plugins: Record<string, StoredPluginData>): Promise<void> => {
  await chrome.storage.local.set({ [PLUGINS_STORAGE_KEY]: plugins });
};

/**
 * Install or update a plugin from an install payload (sent by the MCP server).
 *
 * If the plugin already exists, this is an upgrade: the version, adapter code,
 * configs, and manifest are updated while preserving the enabled state and
 * original install timestamp.
 *
 * @param payload - The plugin install payload from the MCP server
 * @returns The reason ('install' for new, 'upgrade' for existing) and previous version
 */
const installPlugin = async (
  payload: PluginInstallPayload,
): Promise<{ reason: 'install' | 'upgrade'; previousVersion?: string }> => {
  const plugins = await getAllPlugins();
  const existing = plugins[payload.name];

  const now = Date.now();

  const data: StoredPluginData = {
    manifest: payload.manifest,
    adapterCode: payload.adapterCode,
    serviceConfigs: payload.serviceConfigs,
    serviceDefinitions: payload.serviceDefinitions,
    enabled: existing?.enabled ?? true,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    version: payload.version,
    trustTier: payload.trustTier,
  };

  plugins[payload.name] = data;
  await saveAllPlugins(plugins);

  if (existing) {
    return { reason: 'upgrade', previousVersion: existing.version };
  }
  return { reason: 'install' };
};

/**
 * Uninstall a plugin by removing all its data from storage.
 *
 * @param name - The plugin name to uninstall
 * @returns true if the plugin was found and removed, false if it wasn't installed
 */
const uninstallPlugin = async (name: string): Promise<boolean> => {
  const plugins = await getAllPlugins();

  if (!plugins[name]) {
    return false;
  }

  delete plugins[name];
  await saveAllPlugins(plugins);
  return true;
};

/**
 * Set a plugin's enabled state.
 *
 * @param name - The plugin name
 * @param enabled - Whether the plugin should be enabled
 * @returns true if the plugin was found and updated, false if not installed
 */
const setPluginEnabled = async (name: string, enabled: boolean): Promise<boolean> => {
  const plugins = await getAllPlugins();
  const plugin = plugins[name];

  if (!plugin) {
    return false;
  }

  // Avoid unnecessary writes
  if (plugin.enabled === enabled) {
    return true;
  }

  plugins[name] = {
    ...plugin,
    enabled,
    updatedAt: Date.now(),
  };

  await saveAllPlugins(plugins);
  return true;
};

/**
 * Bulk install multiple plugins at once (used during initial sync when
 * the MCP server pushes all discovered plugins to the extension).
 *
 * Preserves the enabled state of plugins that are already installed.
 * Removes plugins that are no longer in the payload (they were uninstalled
 * from the MCP server side).
 *
 * @param payloads - Array of plugin install payloads
 * @returns Summary of what changed
 */
const syncPlugins = async (
  payloads: readonly PluginInstallPayload[],
): Promise<{
  installed: string[];
  upgraded: string[];
  removed: string[];
  unchanged: string[];
}> => {
  const existing = await getAllPlugins();
  const now = Date.now();

  const incomingNames = new Set(payloads.map(p => p.name));
  const result = {
    installed: [] as string[],
    upgraded: [] as string[],
    removed: [] as string[],
    unchanged: [] as string[],
  };

  const updated: Record<string, StoredPluginData> = {};

  // Process incoming plugins
  for (const payload of payloads) {
    const prev = existing[payload.name];

    if (!prev) {
      // New plugin
      updated[payload.name] = {
        manifest: payload.manifest,
        adapterCode: payload.adapterCode,
        serviceConfigs: payload.serviceConfigs,
        serviceDefinitions: payload.serviceDefinitions,
        enabled: true,
        installedAt: now,
        updatedAt: now,
        version: payload.version,
        trustTier: payload.trustTier,
      };
      result.installed.push(payload.name);
    } else if (prev.version !== payload.version || prev.adapterCode !== payload.adapterCode) {
      // Upgraded plugin — preserve enabled state and install timestamp
      updated[payload.name] = {
        manifest: payload.manifest,
        adapterCode: payload.adapterCode,
        serviceConfigs: payload.serviceConfigs,
        serviceDefinitions: payload.serviceDefinitions,
        enabled: prev.enabled,
        installedAt: prev.installedAt,
        updatedAt: now,
        version: payload.version,
        trustTier: payload.trustTier,
      };
      result.upgraded.push(payload.name);
    } else {
      // Unchanged — keep existing data
      updated[payload.name] = prev;
      result.unchanged.push(payload.name);
    }
  }

  // Detect removed plugins (in storage but not in incoming payload)
  for (const name of Object.keys(existing)) {
    if (!incomingNames.has(name)) {
      result.removed.push(name);
      // Do NOT add to `updated` — this removes it from storage
    }
  }

  await saveAllPlugins(updated);
  return result;
};

/**
 * Clear all plugin data from storage. Used for debugging and testing.
 */
const clearAllPlugins = async (): Promise<void> => {
  await chrome.storage.local.remove(PLUGINS_STORAGE_KEY);
};

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

export {
  // Read
  getAllPlugins,
  getPlugin,
  isPluginInstalled,
  getEnabledPlugins,
  getAdapterCode,
  getEnabledUrlPatterns,
  findPluginForUrl,
  findPluginsForUrl,
  getPluginStatuses,
  // Write
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  syncPlugins,
  clearAllPlugins,
};
