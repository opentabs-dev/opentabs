import type { ServiceEnvironment, ServiceSource } from './services.js';

// ---------------------------------------------------------------------------
// Plugin Manifest — the primary configuration interface for plugins
// ---------------------------------------------------------------------------

/** Adapter configuration: how the plugin injects into web pages */
interface PluginAdapterConfig {
  /** Domains the plugin operates on (e.g., ["app.slack.com"]) */
  readonly domains: readonly string[];
  /** Chrome match patterns for URL matching */
  readonly urlPatterns: readonly string[];
  /** Chrome host permissions required */
  readonly hostPermissions: readonly string[];
  /** Default URL to open when no matching tab is found */
  readonly defaultUrl: string;
}

/** Health check configuration */
interface PluginHealthCheckConfig {
  /** JSON-RPC method to call for health check (must be prefixed with the service name) */
  readonly method: string;
  /** Parameters to pass to the health check method */
  readonly params?: Record<string, unknown>;
}

/** Service configuration: runtime behavior of the plugin's service */
interface PluginServiceConfig {
  /** Request timeout in milliseconds */
  readonly timeout: number;
  /** Environments this service runs in */
  readonly environments: readonly ServiceEnvironment[];
  /** Patterns that identify authentication errors in API responses */
  readonly authErrorPatterns?: readonly string[];
  /** Health check configuration */
  readonly healthCheck?: PluginHealthCheckConfig;
  /** Message shown when the service is not connected */
  readonly notConnectedMessage?: string;
  /** Message shown when no matching tab is found */
  readonly tabNotFoundMessage?: string;
}

/** Tool category for grouping in the side panel */
interface PluginToolCategory {
  readonly name: string;
  readonly tools: readonly string[];
}

/** Permissions the plugin requests */
interface PluginPermissions {
  /** Network domains the plugin may fetch from (via adapter) */
  readonly network?: readonly string[];
  /** Storage keys the plugin may use */
  readonly storage?: readonly string[];
  /** Native Chrome APIs the plugin may call via sendBrowserRequest */
  readonly nativeApis?: readonly NativeApiPermission[];
}

/** Native Chrome API permission names */
type NativeApiPermission = 'browser' | 'tabs' | 'scripting' | 'storage';

/** Trust tier for installed plugins */
type TrustTier = 'official' | 'community' | 'local';

/**
 * Full plugin manifest — the authoritative configuration for a plugin.
 * Defined in opentabs-plugin.json and loaded by the plugin-loader.
 */
interface PluginManifest {
  /** Plugin package name (e.g., "slack", "datadog") */
  readonly name: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Semver version */
  readonly version: string;
  /** Short description */
  readonly description: string;
  /** Author name or identifier */
  readonly author: string;
  /** Icon name for the extension UI */
  readonly icon: string;
  /** Adapter configuration */
  readonly adapter: PluginAdapterConfig;
  /** Service runtime configuration */
  readonly service: PluginServiceConfig;
  /** Tool categories for side panel grouping */
  readonly tools: {
    readonly categories: readonly PluginToolCategory[];
  };
  /** Permissions the plugin requests */
  readonly permissions: PluginPermissions;
}

// ---------------------------------------------------------------------------
// Stored variants — JSON-serializable subsets for chrome.storage
// ---------------------------------------------------------------------------

/**
 * JSON-serializable subset of PluginManifest.
 * Stored in chrome.storage.local — no function references, no readonly arrays
 * (chrome.storage serializes to plain JSON).
 */
interface StoredPluginManifest {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly icon: string;
  readonly adapter: PluginAdapterConfig;
  readonly service: PluginServiceConfig;
  readonly tools: {
    readonly categories: readonly PluginToolCategory[];
  };
  readonly permissions: PluginPermissions;
}

/** JSON-serializable service definition for extension storage */
interface StoredServiceDefinition {
  readonly type: string;
  readonly displayName: string;
  readonly environments: readonly ServiceEnvironment[];
  readonly domains: readonly string[];
  readonly urlPatterns: readonly string[];
  readonly iconName: string;
  readonly timeout: number;
  readonly defaultUrl: string;
  readonly hostPermissions: readonly string[];
  readonly source: ServiceSource;
  readonly packageName?: string;
}

/** JSON-serializable service config for extension storage */
interface StoredServiceConfig {
  readonly type: string;
  readonly timeout: number;
  readonly environments: readonly ServiceEnvironment[];
  readonly authErrorPatterns: readonly string[];
  readonly healthCheck?: PluginHealthCheckConfig;
  readonly notConnectedMessage?: string;
  readonly tabNotFoundMessage?: string;
}

// ---------------------------------------------------------------------------
// Plugin Install Payload — sent from MCP server to extension
// ---------------------------------------------------------------------------

/** Payload sent from the MCP server to the Chrome extension when installing a plugin */
interface PluginInstallPayload {
  /** Plugin package name */
  readonly name: string;
  /** Adapter IIFE source code for MAIN world injection */
  readonly adapterCode: string;
  /** Full plugin manifest */
  readonly manifest: StoredPluginManifest;
  /** Service definitions to register */
  readonly serviceDefinitions: readonly StoredServiceDefinition[];
  /** Service configs for the extension's service controller */
  readonly serviceConfigs: readonly StoredServiceConfig[];
  /** Plugin version */
  readonly version: string;
  /** Trust tier of the plugin */
  readonly trustTier: TrustTier;
}

export {
  type NativeApiPermission,
  type TrustTier,
  type PluginAdapterConfig,
  type PluginHealthCheckConfig,
  type PluginServiceConfig,
  type PluginToolCategory,
  type PluginPermissions,
  type PluginManifest,
  type StoredPluginManifest,
  type StoredServiceDefinition,
  type StoredServiceConfig,
  type PluginInstallPayload,
};
