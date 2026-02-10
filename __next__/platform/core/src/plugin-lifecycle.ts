// =============================================================================
// Plugin Lifecycle Hooks
//
// Defines the contract between a plugin and the platform for lifecycle events.
// Plugins can optionally export lifecycle hooks from their tools entry module.
// The platform invokes these hooks at the appropriate time during plugin
// install, uninstall, enable, disable, and settings changes.
//
// Lifecycle hooks run in the MCP server process (Node/Bun), NOT in the
// browser extension or the web page. They have access to the same
// sendServiceRequest / sendBrowserRequest APIs as tool handlers.
//
// All hooks are optional and async. A plugin that doesn't export any hooks
// still works — it just doesn't react to lifecycle transitions.
// =============================================================================

// -----------------------------------------------------------------------------
// Lifecycle Event Types
// -----------------------------------------------------------------------------

/**
 * Context passed to every lifecycle hook. Provides information about the
 * plugin and the environment it's running in.
 */
export interface PluginLifecycleContext {
  /** The plugin name (matches the `name` field in opentabs-plugin.json). */
  readonly pluginName: string;

  /** The plugin version (semver string). */
  readonly pluginVersion: string;

  /** Absolute path to the plugin package root directory. */
  readonly packagePath: string;

  /**
   * Current user settings for this plugin, keyed by setting name.
   * Empty object if no settings are configured or defined.
   */
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * Context for the `onInstall` hook, which fires when a plugin is first
 * installed (its adapter code and manifest are stored in the extension).
 */
export interface PluginInstallContext extends PluginLifecycleContext {
  /**
   * Whether this is a fresh install or a version upgrade.
   * - 'install': First time the plugin is being installed.
   * - 'upgrade': Plugin was already installed with a different version.
   */
  readonly reason: 'install' | 'upgrade';

  /**
   * The previous version string when `reason` is 'upgrade'.
   * Undefined for fresh installs.
   */
  readonly previousVersion?: string;
}

/**
 * Context for the `onUninstall` hook, which fires just before a plugin's
 * data is removed from the extension. Uses the base context — no additional
 * fields needed. Defined as a distinct type for forward compatibility.
 */
export type PluginUninstallContext = PluginLifecycleContext;

/**
 * Context for the `onEnable` hook, which fires when a previously disabled
 * plugin is re-enabled by the user. Uses the base context.
 */
export type PluginEnableContext = PluginLifecycleContext;

/**
 * Context for the `onDisable` hook, which fires when the user disables
 * a plugin (its adapter is no longer injected, its tools are hidden).
 * Uses the base context.
 */
export type PluginDisableContext = PluginLifecycleContext;

/**
 * Context for the `onSettingsChange` hook, which fires when the user
 * modifies any of the plugin's settings via the options page.
 */
export interface PluginSettingsChangeContext extends PluginLifecycleContext {
  /** The settings values before the change. */
  readonly previousSettings: Readonly<Record<string, unknown>>;

  /**
   * Keys of settings that changed. Plugins can check this to avoid
   * unnecessary re-initialization when only unrelated settings changed.
   */
  readonly changedKeys: readonly string[];
}

// -----------------------------------------------------------------------------
// Lifecycle Hook Signatures
// -----------------------------------------------------------------------------

/**
 * Called when a plugin is installed or upgraded.
 *
 * Use this for one-time setup: logging, initializing default settings,
 * or migrating data between versions.
 *
 * @param ctx - Install context with reason and optional previous version
 */
export type OnInstallHook = (ctx: PluginInstallContext) => Promise<void> | void;

/**
 * Called just before a plugin is uninstalled.
 *
 * Use this for cleanup: clearing caches, logging, or notifying external
 * systems. After this hook returns, the plugin's adapter code and manifest
 * are removed from the extension's storage.
 *
 * @param ctx - Uninstall context
 */
export type OnUninstallHook = (ctx: PluginUninstallContext) => Promise<void> | void;

/**
 * Called when a previously disabled plugin is re-enabled.
 *
 * Use this to re-initialize state, start polling, or re-register
 * error patterns that were cleaned up during disable.
 *
 * @param ctx - Enable context
 */
export type OnEnableHook = (ctx: PluginEnableContext) => Promise<void> | void;

/**
 * Called when the user disables the plugin.
 *
 * Use this to clean up timers, in-memory caches, or any resources that
 * should not persist while the plugin is inactive.
 *
 * @param ctx - Disable context
 */
export type OnDisableHook = (ctx: PluginDisableContext) => Promise<void> | void;

/**
 * Called when the user changes any of the plugin's settings.
 *
 * Use this to react to configuration changes without requiring a
 * full reload. Check `ctx.changedKeys` to determine what changed.
 *
 * @param ctx - Settings change context with previous values and changed keys
 */
export type OnSettingsChangeHook = (ctx: PluginSettingsChangeContext) => Promise<void> | void;

// -----------------------------------------------------------------------------
// Lifecycle Hooks Container
//
// The plugin-loader extracts these from the plugin's tools entry module.
// All hooks are optional — a plugin that doesn't export any hooks is valid.
// -----------------------------------------------------------------------------

/**
 * The complete set of lifecycle hooks a plugin can export.
 * All hooks are optional. The platform calls them at the appropriate time.
 *
 * Plugins export individual hook functions from their tools entry module:
 *
 * ```ts
 * // In tools/index.ts
 * export const onInstall: OnInstallHook = async (ctx) => {
 *   console.log(`${ctx.pluginName} v${ctx.pluginVersion} installed!`);
 * };
 *
 * export const onSettingsChange: OnSettingsChangeHook = async (ctx) => {
 *   if (ctx.changedKeys.includes('apiEndpoint')) {
 *     // Re-initialize connection with new endpoint
 *   }
 * };
 * ```
 */
export interface PluginLifecycleHooks {
  readonly onInstall?: OnInstallHook;
  readonly onUninstall?: OnUninstallHook;
  readonly onEnable?: OnEnableHook;
  readonly onDisable?: OnDisableHook;
  readonly onSettingsChange?: OnSettingsChangeHook;
}

// -----------------------------------------------------------------------------
// Lifecycle Hook Names — For Dynamic Extraction
// -----------------------------------------------------------------------------

/**
 * The well-known export names that the plugin-loader scans for when
 * importing a plugin's tools entry module. Used by the loader to
 * dynamically extract hooks without hardcoding each name.
 */
export const LIFECYCLE_HOOK_NAMES = ['onInstall', 'onUninstall', 'onEnable', 'onDisable', 'onSettingsChange'] as const;

export type LifecycleHookName = (typeof LIFECYCLE_HOOK_NAMES)[number];

// -----------------------------------------------------------------------------
// Stored Plugin Data — Extension-Side Storage Schema
//
// When the MCP server discovers a plugin, it sends the plugin's manifest,
// adapter code, and service configuration to the extension. The extension
// stores this data in chrome.storage.local and uses it to dynamically
// inject adapters and manage service controllers at runtime.
// -----------------------------------------------------------------------------

/**
 * The data stored per-plugin in `chrome.storage.local`.
 * This is the extension's source of truth for installed plugins.
 *
 * Storage key: `plugin:<name>` (e.g. `plugin:slack`)
 */
export interface StoredPluginData {
  /** The validated plugin manifest. */
  readonly manifest: StoredPluginManifest;

  /** The compiled adapter IIFE source code (as a string). */
  readonly adapterCode: string;

  /** Service controller configs, keyed by service ID. */
  readonly serviceConfigs: Record<string, StoredServiceConfig>;

  /** Service definitions for the service registry. */
  readonly serviceDefinitions: readonly StoredServiceDefinition[];

  /** Whether the plugin is currently enabled. */
  readonly enabled: boolean;

  /** Timestamp when the plugin was installed (epoch ms). */
  readonly installedAt: number;

  /** Timestamp of the most recent update (epoch ms). */
  readonly updatedAt: number;

  /** The plugin version at install/update time. */
  readonly version: string;

  /** Trust tier determined during discovery. */
  readonly trustTier: 'official' | 'verified' | 'community' | 'local';
}

/**
 * Subset of PluginManifest that is JSON-serializable for storage.
 * The full PluginManifest is used for validation; this is the subset
 * the extension needs at runtime.
 */
export interface StoredPluginManifest {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly icon?: string;

  readonly adapter: {
    readonly domains: Record<string, string>;
    readonly urlPatterns: Record<string, readonly string[]>;
    readonly hostPermissions?: readonly string[];
    readonly defaultUrl?: string;
  };

  readonly service: {
    readonly timeout: number;
    readonly environments: readonly string[];
    readonly authErrorPatterns: readonly string[];
    readonly healthCheck: {
      readonly method: string;
      readonly params: Record<string, unknown>;
      readonly evaluator?: string;
    };
    readonly notConnectedMessage?: string;
    readonly tabNotFoundMessage?: string;
  };

  readonly tools: {
    readonly categories?: readonly {
      readonly id: string;
      readonly label: string;
      readonly tools?: readonly string[];
    }[];
  };

  readonly permissions: {
    readonly network: readonly string[];
    readonly storage?: boolean;
    readonly nativeApis?: readonly string[];
  };
}

/**
 * JSON-serializable service definition for storage.
 * Mirrors ServiceDefinition from services.ts but guaranteed serializable
 * (no function references).
 */
export interface StoredServiceDefinition {
  readonly type: string;
  readonly displayName: string;
  readonly environments: readonly string[];
  readonly domains: Record<string, string>;
  readonly urlPatterns: Record<string, readonly string[]>;
  readonly iconName: string;
  readonly timeout: number;
  readonly defaultUrl?: string;
  readonly hostPermissions?: readonly string[];
  readonly source: 'plugin';
  readonly packageName?: string;
}

/**
 * JSON-serializable service controller config for storage.
 * Mirrors WebappServiceConfig but without function references (isHealthy
 * is resolved at runtime from the evaluator name, not stored as a function).
 */
export interface StoredServiceConfig {
  readonly serviceId: string;
  readonly displayName: string;
  readonly adapterName: string;
  readonly urlPatterns: readonly string[];
  readonly domain: string;
  readonly authErrorPatterns: readonly string[];
  readonly healthCheck: {
    readonly method: string;
    readonly params: Record<string, unknown>;
  };
  readonly healthCheckEvaluator?: string;
  readonly notConnectedMessage?: string;
  readonly tabNotFoundMessage?: string;
}

// -----------------------------------------------------------------------------
// Plugin Install/Uninstall Payloads — MCP Server → Extension
//
// These are the message payloads sent over WebSocket when the MCP server
// discovers, updates, or removes plugins. The extension receives these
// and updates chrome.storage.local accordingly.
// -----------------------------------------------------------------------------

/**
 * Payload sent from the MCP server to the extension to install or update
 * a plugin. Contains everything the extension needs to store and activate
 * the plugin without a rebuild.
 */
export interface PluginInstallPayload {
  /** The plugin name (unique identifier). */
  readonly name: string;

  /** The compiled adapter IIFE source code. */
  readonly adapterCode: string;

  /** The plugin manifest (JSON-serializable subset). */
  readonly manifest: StoredPluginManifest;

  /** Service definitions for the service registry. */
  readonly serviceDefinitions: readonly StoredServiceDefinition[];

  /** Service controller configs, keyed by service ID. */
  readonly serviceConfigs: Record<string, StoredServiceConfig>;

  /** Plugin version. */
  readonly version: string;

  /** Trust tier. */
  readonly trustTier: 'official' | 'verified' | 'community' | 'local';
}

/**
 * Payload sent from the MCP server to the extension to uninstall a plugin.
 */
export interface PluginUninstallPayload {
  /** The plugin name to uninstall. */
  readonly name: string;
}

/**
 * Result of a plugin install operation, sent from the extension back to
 * the MCP server as confirmation.
 */
export interface PluginInstallResult {
  readonly success: boolean;
  readonly name: string;
  readonly version: string;
  readonly reason: 'install' | 'upgrade';
  readonly previousVersion?: string;
  readonly error?: string;
}

/**
 * Result of a plugin uninstall operation.
 */
export interface PluginUninstallResult {
  readonly success: boolean;
  readonly name: string;
  readonly error?: string;
}
