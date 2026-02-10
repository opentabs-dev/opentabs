// =============================================================================
// Plugin Manifest Types
//
// The contract between a plugin and the OpenTabs platform. Every plugin ships
// an `opentabs-plugin.json` file conforming to this schema. The platform reads
// it at build time (adapter compilation, manifest generation) and at runtime
// (tool registration, service controller creation).
//
// This module defines TYPES ONLY — validation logic lives in @opentabs/plugin-loader.
// =============================================================================

import type { JsonRpcResponse } from './json-rpc.js';
import type { ServiceEnv } from './services.js';

// -----------------------------------------------------------------------------
// Plugin Manifest — Top Level
// -----------------------------------------------------------------------------

/**
 * The complete plugin manifest. Corresponds 1:1 with `opentabs-plugin.json`.
 *
 * Plugin authors can write this as JSON or use the `definePlugin()` helper
 * from `@opentabs/plugin-sdk` for TypeScript type-checking.
 */
export interface PluginManifest {
  /**
   * Schema version for forward compatibility. The platform validates
   * manifests against the schema version and rejects incompatible ones.
   */
  readonly $schema?: string;

  /**
   * Unique plugin identifier. Used as the JSON-RPC method prefix, adapter
   * registration name, and service type. Must be lowercase alphanumeric
   * with hyphens (e.g. 'jira', 'google-sheets', 'internal-dashboard').
   *
   * Naming rules:
   * - Must match /^[a-z][a-z0-9-]*$/
   * - Must not collide with platform-reserved names ('browser', 'system', 'extension')
   * - Must not collide with other installed plugins
   */
  readonly name: string;

  /** Human-readable display name shown in the UI (e.g. 'Jira', 'Google Sheets'). */
  readonly displayName: string;

  /** Plugin version following semver (e.g. '1.2.3'). */
  readonly version: string;

  /** Short description of what the plugin does. Shown in the plugin registry. */
  readonly description: string;

  /** Plugin author name or organization. */
  readonly author?: string;

  /** URL to the plugin's homepage or repository. */
  readonly homepage?: string;

  /** SPDX license identifier (e.g. 'MIT', 'Apache-2.0'). */
  readonly license?: string;

  /** Adapter configuration — how the plugin injects into web pages. */
  readonly adapter: PluginAdapterConfig;

  /** Service configuration — how the platform manages the tab lifecycle. */
  readonly service: PluginServiceConfig;

  /** MCP tool configuration — where to find the tool registration module. */
  readonly tools: PluginToolsConfig;

  /** Permission declarations — what the plugin needs access to. */
  readonly permissions: PluginPermissions;

  /** Optional user-configurable settings schema. */
  readonly settings?: Record<string, PluginSettingDefinition>;

  /**
   * Relative path to the plugin icon (PNG, 48x48 recommended).
   * Shown in the side panel and options page.
   */
  readonly icon?: string;

  /**
   * Keywords for discovery in the plugin registry.
   * The platform auto-adds 'opentabs-plugin' to all plugins.
   */
  readonly keywords?: readonly string[];
}

// -----------------------------------------------------------------------------
// Adapter Configuration
// -----------------------------------------------------------------------------

/**
 * Describes how the plugin's MAIN world adapter is injected into web pages.
 * The platform uses this to register content scripts and scope adapter dispatch.
 */
export interface PluginAdapterConfig {
  /**
   * Relative path to the compiled adapter entry point (IIFE format).
   * The build system compiles this into the extension bundle.
   * Example: './dist/adapter.js'
   */
  readonly entry: string;

  /**
   * Domain strings keyed by environment. Used for URL matching and the
   * `matchesUrl()` check in the service controller.
   *
   * Examples:
   * - Single env:  { production: '.slack.com' }
   * - Multi env:   { production: 'app.example.com', staging: 'staging.example.com' }
   *
   * A leading dot means "any subdomain" (e.g. '.slack.com' matches 'brex.slack.com').
   */
  readonly domains: Record<string, string>;

  /**
   * URL match patterns keyed by environment. Used for:
   * - chrome.scripting.registerContentScripts (adapter injection)
   * - chrome.tabs.query (tab discovery)
   * - Extension manifest content_scripts and web_accessible_resources
   *
   * Must use Chrome's match pattern syntax: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
   * Example: { production: ['*://*.slack.com/*'] }
   */
  readonly urlPatterns: Record<string, readonly string[]>;

  /**
   * Explicit host permission patterns for the extension manifest.
   * When omitted, derived from urlPatterns by replacing '*://' with 'https://'.
   *
   * Needed when the service requires permissions on additional origins
   * (e.g. Slack needs both '*.slack.com' and 'edgeapi.slack.com').
   */
  readonly hostPermissions?: readonly string[];

  /**
   * Canonical URL for the service, used in error messages and UI links.
   * When omitted, derived as `https://${production_domain}`.
   * Needed when the production domain has a leading dot or wildcard.
   */
  readonly defaultUrl?: string;
}

// -----------------------------------------------------------------------------
// Service Configuration
// -----------------------------------------------------------------------------

/**
 * Describes how the platform manages the service's tab lifecycle:
 * environment support, timeouts, health checks, and authentication detection.
 */
export interface PluginServiceConfig {
  /**
   * Request timeout in milliseconds. The platform aborts requests to the
   * adapter that exceed this duration. Recommended: 30000 for fast APIs,
   * 60000 for slow APIs, up to 300000 for long-running operations.
   */
  readonly timeout: number;

  /**
   * Environments this service supports. Most services have ['production'].
   * Multi-environment services (e.g. production + staging) get separate
   * service IDs and tab connections.
   */
  readonly environments: readonly ServiceEnv[];

  /**
   * Substrings in error messages that indicate an expired or invalid session.
   * When the health check returns an error containing any of these patterns,
   * the platform marks the session as disconnected and attempts reconnection.
   *
   * Examples: ['401', '403', 'Unauthorized', 'invalid_auth', 'token_revoked']
   */
  readonly authErrorPatterns: readonly string[];

  /**
   * Health check configuration. The platform periodically sends this
   * JSON-RPC request to the adapter and evaluates the response to determine
   * whether the authenticated session is still valid.
   */
  readonly healthCheck: PluginHealthCheckConfig;

  /**
   * Custom error message shown when no tab is connected for this service.
   * When omitted, the platform generates a default message from displayName.
   */
  readonly notConnectedMessage?: string;

  /**
   * Custom error message shown when the previously connected tab is gone.
   * When omitted, the platform generates a default message from displayName.
   */
  readonly tabNotFoundMessage?: string;
}

/**
 * Health check definition — the JSON-RPC method and params the platform
 * sends to the adapter periodically to verify the session is alive.
 */
export interface PluginHealthCheckConfig {
  /**
   * JSON-RPC method to call. Convention: '<plugin-name>.<action>'.
   * Example: 'slack.api', 'jira.api', 'snowflake.healthCheck'
   */
  readonly method: string;

  /** JSON-RPC params for the health check request. */
  readonly params: Record<string, unknown>;

  /**
   * Custom health evaluation function name. When omitted, the platform
   * uses the default: response is healthy if it's not a JSON-RPC error.
   *
   * When provided, this must be one of the well-known evaluator names:
   * - 'slack-api-ok-field': Checks response.result.ok === true
   * - 'snowflake-user-field': Checks response.result.user is truthy
   * - 'default': !isJsonRpcError(response)
   *
   * For fully custom evaluation, plugins implement isHealthy in the tools
   * entry module and the plugin-loader wires it into the service config.
   */
  readonly evaluator?: string;
}

// -----------------------------------------------------------------------------
// Tools Configuration
// -----------------------------------------------------------------------------

/**
 * Describes where to find the plugin's MCP tool registration module.
 * The module must export a `registerTools(server: McpServer) => Map<string, RegisteredTool>`
 * function, following the standard OpenTabs tool registration pattern.
 */
export interface PluginToolsConfig {
  /**
   * Relative path to the compiled tools entry module.
   * Example: './dist/tools/index.js'
   *
   * The module is dynamically imported by the MCP server at startup.
   * It must have a named export `registerTools` matching the ToolRegistrationFn type.
   */
  readonly entry: string;

  /**
   * Tool categories for the options page UI. When omitted, tools are
   * displayed in a single flat list under the plugin's displayName.
   */
  readonly categories?: readonly PluginToolCategory[];
}

/** A grouping of tools for the options page UI. */
export interface PluginToolCategory {
  /** Category identifier (e.g. 'messages', 'search', 'admin'). */
  readonly id: string;

  /** Human-readable category label (e.g. 'Messages', 'Search', 'Administration'). */
  readonly label: string;

  /**
   * Tool ID prefixes that belong to this category.
   * Example: ['slack_send_message', 'slack_read_messages', 'slack_read_thread']
   *
   * When omitted, tools are assigned to a category by prefix matching on the
   * category id: tools starting with `<plugin-name>_<category-id>` are included.
   */
  readonly tools?: readonly string[];
}

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

/**
 * Permission declarations. The platform enforces these at build time
 * (manifest generation) and runtime (request validation).
 *
 * Plugins CANNOT request permissions beyond what they declare here.
 */
export interface PluginPermissions {
  /**
   * Network domains the adapter is allowed to access. The platform wraps
   * the adapter's fetch calls to enforce this allowlist.
   *
   * Supports wildcards: '*.example.com' matches 'api.example.com'.
   * Must be a subset of the adapter's declared domains.
   *
   * Example: ['*.atlassian.net', 'api.atlassian.com']
   */
  readonly network: readonly string[];

  /**
   * Whether the adapter needs access to localStorage/sessionStorage.
   * Default: false. When true, the platform does not restrict storage access.
   * When false, the adapter sandbox blocks storage reads (for extra safety
   * on pages where another plugin has a more privileged adapter).
   */
  readonly storage?: boolean;

  /**
   * Platform-native API access. Plugins don't get chrome.* APIs directly,
   * but they can request access to platform capabilities:
   *
   * - 'browser': Access to browser tab tools (listTabs, openTab, etc.)
   * - 'files': Access to the file store API (streaming large data to disk)
   *
   * Most plugins need neither — they communicate exclusively through their
   * own adapter.
   */
  readonly nativeApis?: readonly NativeApiPermission[];
}

/** Well-known platform-native API capabilities that plugins can request. */
export type NativeApiPermission = 'browser' | 'files';

// -----------------------------------------------------------------------------
// Plugin Settings
// -----------------------------------------------------------------------------

/**
 * A single user-configurable setting. Rendered in the options page under
 * the plugin's section. Stored in chrome.storage.sync under
 * `pluginSettings.<pluginName>.<key>`.
 */
export interface PluginSettingDefinition {
  /** Setting type determines the input control. */
  readonly type: 'string' | 'number' | 'boolean' | 'select';

  /** Human-readable label for the setting. */
  readonly label: string;

  /** Optional help text shown below the input. */
  readonly description?: string;

  /** Default value when the user hasn't configured it. */
  readonly default?: string | number | boolean;

  /** For 'number' type: minimum allowed value. */
  readonly min?: number;

  /** For 'number' type: maximum allowed value. */
  readonly max?: number;

  /** For 'select' type: available options. */
  readonly options?: readonly PluginSettingOption[];

  /** For 'string' type: placeholder text. */
  readonly placeholder?: string;
}

/** An option in a select setting. */
export interface PluginSettingOption {
  readonly value: string;
  readonly label: string;
}

// -----------------------------------------------------------------------------
// Health Check Evaluator
//
// Plugins that need custom health check logic beyond the built-in evaluators
// can export an `isHealthy` function from their tools entry module. The
// plugin-loader detects this export and wires it into the service controller.
// -----------------------------------------------------------------------------

/**
 * Signature for a custom health check evaluator function.
 * Exported from the plugin's tools entry module as `isHealthy`.
 */
export type HealthCheckEvaluator = (
  response: JsonRpcResponse,
  authErrorPatterns: readonly string[],
) => boolean;

// -----------------------------------------------------------------------------
// Resolved Plugin — Internal Platform Type
//
// After the plugin-loader validates and resolves a manifest, it produces a
// ResolvedPlugin with absolute paths and loaded modules. Platform code
// operates on ResolvedPlugin, not raw PluginManifest.
// -----------------------------------------------------------------------------

/**
 * A fully resolved and validated plugin, ready for use by the platform.
 * Produced by the plugin-loader after discovery, validation, and module loading.
 */
export interface ResolvedPlugin {
  /** The validated plugin manifest. */
  readonly manifest: PluginManifest;

  /** Absolute path to the plugin package root directory. */
  readonly packagePath: string;

  /** Absolute path to the compiled adapter IIFE file. */
  readonly adapterPath: string;

  /**
   * The plugin's tool registration function, dynamically imported from the
   * tools entry module. Conforms to the standard registerTools signature.
   */
  readonly registerTools: ToolRegistrationFn;

  /**
   * Optional custom health check evaluator, imported from the tools entry
   * module if it exports an `isHealthy` function.
   */
  readonly isHealthy?: HealthCheckEvaluator;

  /** Trust tier, determined by the package name and registry status. */
  readonly trustTier: PluginTrustTier;
}

/** Trust tiers for plugin verification. */
export type PluginTrustTier = 'official' | 'verified' | 'community' | 'local';

/**
 * The standard tool registration function signature. Every plugin's tools
 * entry module must export a named function matching this type.
 *
 * This type is also used by the platform's built-in tools (browser, extension).
 * Defined here (not in plugin-sdk) because the platform needs it without
 * depending on the SDK.
 */
export type ToolRegistrationFn = (
  server: McpServerLike,
) => Map<string, RegisteredToolLike>;

/**
 * Minimal McpServer interface for tool registration. Avoids a hard dependency
 * on @modelcontextprotocol/sdk in @opentabs/core. The actual McpServer
 * satisfies this interface.
 */
export interface McpServerLike {
  registerTool: (...args: unknown[]) => unknown;
}

/**
 * Minimal RegisteredTool interface. Avoids a hard dependency on the MCP SDK.
 * The actual RegisteredTool satisfies this interface.
 */
export interface RegisteredToolLike {
  readonly enabled: boolean;
  update: (config: Record<string, unknown>) => void;
  remove: () => void;
}

// -----------------------------------------------------------------------------
// Reserved Names
//
// Plugin names must not collide with these platform-reserved method prefixes.
// -----------------------------------------------------------------------------

/** Method prefixes reserved by the platform and unavailable for plugins. */
export const RESERVED_PLUGIN_NAMES: readonly string[] = [
  'browser',
  'system',
  'extension',
  'plugin',
  'opentabs',
];

/**
 * Validate that a plugin name doesn't collide with reserved names.
 * Returns the collision if found, undefined if the name is valid.
 */
export const checkReservedName = (name: string): string | undefined =>
  RESERVED_PLUGIN_NAMES.find(reserved => name === reserved);
