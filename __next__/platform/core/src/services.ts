// =============================================================================
// Service Types
//
// Defines the shape of a service (plugin) identity. The platform uses these
// types to manage tab lifecycle, URL matching, health checks, and routing.
//
// IMPORTANT: This module defines TYPES and UTILITIES only — no hardcoded
// service data. The actual registry is built dynamically at startup by merging
// built-in platform services with installed plugin definitions.
//
// Also defines WebappServiceConfig — the shared contract between the build-time
// plugin-loader (which produces configs from plugin manifests) and the runtime
// browser-extension (which consumes them in service controllers).
// =============================================================================

import type { JsonRpcResponse } from './json-rpc.js';

// -----------------------------------------------------------------------------
// Service Identity Types
// -----------------------------------------------------------------------------

/** Environment types for services that support multiple deployments. */
type ServiceEnv = 'production' | 'staging';

/**
 * A single service definition — the canonical identity of a webapp service.
 *
 * This is the shape that every plugin manifest's `adapter` + `service` sections
 * are transformed into. The platform operates entirely on this type: tab
 * matching, adapter injection, health checks, routing, manifest generation,
 * and UI rendering all derive from ServiceDefinition arrays.
 */
interface ServiceDefinition {
  /**
   * Base service type (e.g. 'slack', 'jira'). Used as the adapter name,
   * JSON-RPC method prefix, and routing key. Must be unique across all
   * loaded plugins.
   */
  readonly type: string;

  /** Human-readable display name (e.g. 'Slack', 'Jira'). */
  readonly displayName: string;

  /** Environments this service supports. Most services have only ['production']. */
  readonly environments: readonly ServiceEnv[];

  /**
   * Domain strings keyed by environment. Used for URL matching and hostname
   * lookup. Examples: { production: '.slack.com' }, { production: 'app.jira.com' }
   */
  readonly domains: Readonly<Record<string, string>>;

  /**
   * URL patterns keyed by environment. Used for chrome.tabs.query and the
   * extension manifest's content_scripts / web_accessible_resources.
   * Examples: { production: ['*://*.slack.com/*'] }
   */
  readonly urlPatterns: Readonly<Record<string, readonly string[]>>;

  /** Icon filename (without extension) in the extension's icons directory. */
  readonly iconName: string;

  /** MCP request timeout in milliseconds. */
  readonly timeout: number;

  /**
   * Canonical URL for the service, used in error messages and side panel
   * links. When omitted, derived as `https://${production_domain}`. Needed
   * when the production domain has a leading dot (e.g. '.slack.com').
   */
  readonly defaultUrl?: string;

  /**
   * Explicit host permission patterns for the manifest. When omitted,
   * derived from urlPatterns by replacing `*://` with `https://`.
   */
  readonly hostPermissions?: readonly string[];

  /**
   * Source of the service definition. 'builtin' for platform-native services,
   * 'plugin' for installed plugins. Affects trust level and UI presentation.
   */
  readonly source: 'builtin' | 'plugin';

  /** npm package name for plugin-sourced definitions. */
  readonly packageName?: string;
}

// -----------------------------------------------------------------------------
// Service ID Types
//
// A service ID uniquely identifies a service-environment combination.
// Single-env services use the type directly (e.g. 'slack').
// Multi-env services are suffixed (e.g. 'datadog_production', 'datadog_staging').
// -----------------------------------------------------------------------------

/**
 * A service ID is a string that uniquely identifies a service-environment
 * combination. The platform uses this as the key in connection status maps,
 * service manager records, and storage keys.
 */
type ServiceId = string;

// -----------------------------------------------------------------------------
// Service Registry — Dynamic, Supports Runtime Mutations
// -----------------------------------------------------------------------------

/**
 * The live service registry. Starts empty and is populated during platform
 * initialization by merging built-in definitions with plugin definitions.
 *
 * The registry supports runtime mutations via addServiceDefinitions() and
 * removeServiceDefinitions() to enable dynamic plugin install/uninstall
 * without requiring a full extension rebuild or registry reset.
 *
 * All modules that need service data import this and call the getter.
 */
let registry: ServiceDefinition[] = [];

/**
 * Listeners notified when the registry changes. Used by the browser
 * extension background script to react to dynamic plugin install/uninstall
 * (e.g. creating or destroying service controllers, injecting adapters).
 */
type RegistryChangeListener = (added: readonly ServiceDefinition[], removed: readonly ServiceDefinition[]) => void;

const registryChangeListeners: RegistryChangeListener[] = [];

/**
 * Register a listener that fires whenever the service registry is mutated
 * (via setServiceRegistry, addServiceDefinitions, or removeServiceDefinitions).
 *
 * @param listener - Callback receiving arrays of added and removed definitions
 * @returns An unsubscribe function
 */
const onRegistryChange = (listener: RegistryChangeListener): (() => void) => {
  registryChangeListeners.push(listener);
  return () => {
    const idx = registryChangeListeners.indexOf(listener);
    if (idx >= 0) registryChangeListeners.splice(idx, 1);
  };
};

/** Notify all registry change listeners. */
const notifyRegistryChange = (added: readonly ServiceDefinition[], removed: readonly ServiceDefinition[]): void => {
  for (const listener of registryChangeListeners) {
    try {
      listener(added, removed);
    } catch (err) {
      console.error('[OpenTabs] Registry change listener error:', err);
    }
  }
};

/**
 * Get the current service registry. Returns an empty array before
 * initialization.
 */
const getServiceRegistry = (): readonly ServiceDefinition[] => registry;

/**
 * Replace the service registry contents. Called during platform
 * initialization after all plugins are discovered and validated.
 *
 * Can be called multiple times (e.g. on hot reload). Subsequent calls
 * replace the registry contents entirely.
 */
const setServiceRegistry = (definitions: readonly ServiceDefinition[]): void => {
  const previous = registry;
  registry = [...definitions];

  // Recompute all derived lookup tables
  recomputeDerivedConstants();

  // Determine added/removed for listeners
  const previousTypes = new Set(previous.map(d => d.type));
  const currentTypes = new Set(registry.map(d => d.type));
  const added = registry.filter(d => !previousTypes.has(d.type));
  const removed = previous.filter(d => !currentTypes.has(d.type));
  if (added.length > 0 || removed.length > 0) {
    notifyRegistryChange(added, removed);
  }
};

/**
 * Add service definitions to the registry at runtime.
 *
 * Used when a plugin is dynamically installed without a full rebuild.
 * Throws if any definition's type collides with an existing entry.
 *
 * @param definitions - Service definitions to add
 */
const addServiceDefinitions = (definitions: readonly ServiceDefinition[]): void => {
  const existingTypes = new Set(registry.map(d => d.type));

  for (const def of definitions) {
    if (existingTypes.has(def.type)) {
      throw new Error(
        `Cannot add service "${def.type}": a service with that type is already registered. ` +
          'Uninstall the existing plugin first.',
      );
    }
  }

  registry.push(...definitions);

  // Recompute derived lookup tables
  recomputeDerivedConstants();

  if (definitions.length > 0) {
    notifyRegistryChange(definitions, []);
  }
};

/**
 * Remove service definitions from the registry at runtime.
 *
 * Used when a plugin is dynamically uninstalled. Silently ignores types
 * that are not in the registry (idempotent).
 *
 * @param serviceTypes - The service type strings to remove
 */
const removeServiceDefinitions = (serviceTypes: readonly string[]): void => {
  const toRemove = new Set(serviceTypes);
  const removed = registry.filter(d => toRemove.has(d.type));

  if (removed.length === 0) return;

  registry = registry.filter(d => !toRemove.has(d.type));

  // Recompute derived lookup tables
  recomputeDerivedConstants();

  notifyRegistryChange([], removed);
};

/**
 * Reset the registry to empty. Used only in tests.
 */
const resetServiceRegistry = (): void => {
  registry = [];
  registryChangeListeners.length = 0;
  recomputeDerivedConstants();
};

// -----------------------------------------------------------------------------
// Derived Constants — Recomputed When Registry Changes
//
// These provide the same convenient lookup tables that the original static
// SERVICE_REGISTRY provided, but they're computed from the dynamic registry.
// -----------------------------------------------------------------------------

let _serviceIds: string[] = [];
let _serviceTypes: string[] = [];
let _urlPatterns: Record<string, string[]> = {};
let _domains: Record<string, string> = {};
let _timeouts: Record<string, number> = {};
let _displayNames: Record<string, string> = {};
let _singleEnvServices: string[] = [];

const recomputeDerivedConstants = (): void => {
  _serviceIds = registry.flatMap(def =>
    def.environments.length === 1 ? [def.type] : def.environments.map(env => `${def.type}_${env}`),
  );

  _serviceTypes = registry.map(def => def.type);

  _urlPatterns = {};
  _domains = {};
  for (const def of registry) {
    if (def.environments.length === 1) {
      const env = def.environments[0]!;
      _urlPatterns[def.type] = [...def.urlPatterns[env]!];
      _domains[def.type] = def.domains[env]!;
    } else {
      for (const env of def.environments) {
        const serviceId = `${def.type}_${env}`;
        _urlPatterns[serviceId] = [...def.urlPatterns[env]!];
        _domains[serviceId] = def.domains[env]!;
      }
    }
  }

  _timeouts = Object.fromEntries(registry.map(def => [def.type, def.timeout]));
  _displayNames = Object.fromEntries(registry.map(def => [def.type, def.displayName]));
  _singleEnvServices = registry.filter(def => def.environments.length === 1).map(def => def.type);
};

/** All service IDs (e.g. ['slack', 'datadog_production', 'datadog_staging']). */
const getServiceIds = (): readonly string[] => _serviceIds;

/** All service types (e.g. ['slack', 'datadog']). */
const getServiceTypes = (): readonly string[] => _serviceTypes;

/** URL patterns keyed by service ID. */
const getServiceUrlPatterns = (): Readonly<Record<string, string[]>> => _urlPatterns;

/** Domain strings keyed by service ID. */
const getServiceDomains = (): Readonly<Record<string, string>> => _domains;

/** Request timeout per service type (milliseconds). */
const getServiceTimeouts = (): Readonly<Record<string, number>> => _timeouts;

/** Human-readable display names keyed by service type. */
const getServiceDisplayNames = (): Readonly<Record<string, string>> => _displayNames;

/** Service types that have a single environment (no production/staging split). */
const getSingleEnvServices = (): readonly string[] => _singleEnvServices;

// -----------------------------------------------------------------------------
// Lookup Helpers
// -----------------------------------------------------------------------------

/** Resolve a service ID to its base service type. */
const getServiceType = (serviceId: string): string | undefined => {
  // Direct match (single-env services)
  const direct = registry.find(def => def.type === serviceId);
  if (direct) return direct.type;

  // Extract type from env-suffixed ID
  for (const def of registry) {
    if (def.environments.length > 1) {
      for (const env of def.environments) {
        if (serviceId === `${def.type}_${env}`) return def.type;
      }
    }
  }

  return undefined;
};

/** Reverse lookup: hostname → service type (undefined if no match). */
const getServiceTypeFromHostname = (hostname: string): string | undefined => {
  for (const [serviceId, domain] of Object.entries(_domains)) {
    if (hostname.endsWith(domain) || hostname === domain) {
      return getServiceType(serviceId);
    }
  }
  return undefined;
};

/** Get the ServiceDefinition for a service type. */
const getServiceDefinition = (serviceType: string): ServiceDefinition | undefined =>
  registry.find(def => def.type === serviceType);

/** Derive the ServiceEnv from a service ID (undefined for single-env services). */
const getServiceEnv = (serviceId: string): ServiceEnv | undefined => {
  if (serviceId.endsWith('_production')) return 'production';
  if (serviceId.endsWith('_staging')) return 'staging';
  return undefined;
};

/**
 * Get the canonical URL for a service ID (used in side panel links and
 * error messages). For most services this is `https://${domain}`. For
 * services with wildcard domains (leading dot), uses `defaultUrl`.
 */
const getServiceUrl = (serviceId: string): string => {
  const domain = _domains[serviceId];
  if (!domain) return '#';
  if (domain.startsWith('.')) {
    const serviceType = getServiceType(serviceId);
    const def = serviceType ? getServiceDefinition(serviceType) : undefined;
    return def?.defaultUrl ?? `https://${domain.slice(1)}`;
  }
  return `https://${domain}`;
};

/**
 * Compute all service IDs from a set of definitions.
 * Utility for plugin-loader and build scripts that operate on partial registries.
 */
const computeServiceIds = (definitions: readonly ServiceDefinition[]): string[] =>
  definitions.flatMap(def =>
    def.environments.length === 1 ? [def.type] : def.environments.map(env => `${def.type}_${env}`),
  );

// -----------------------------------------------------------------------------
// Webapp Service Config — Build-Time ↔ Runtime Contract
//
// The plugin-loader produces these configs from plugin manifests at build time.
// The browser extension's service controllers consume them at runtime. Both
// packages depend on @opentabs/core, so this is the natural home for the type.
// -----------------------------------------------------------------------------

/**
 * Health check definition — the JSON-RPC method + params to send to the
 * adapter to verify the user's session is still valid.
 */
interface HealthCheckConfig {
  /** JSON-RPC method (e.g. 'slack.api', 'datadog.api') */
  readonly method: string;
  /** JSON-RPC params for the health check request */
  readonly params: Record<string, unknown>;
}

/**
 * Declarative configuration for a webapp service controller.
 *
 * Produced from plugin manifests by the plugin-loader's
 * manifestToServiceConfigs() at build time. Consumed by the browser
 * extension's WebappServiceController at runtime.
 *
 * Most services differ only in data (URLs, auth patterns, health check
 * endpoint). Services with unique health-check logic supply an `isHealthy`
 * override.
 */
interface WebappServiceConfig {
  /** Unique service identifier (e.g. 'slack', 'datadog_production') */
  readonly serviceId: string;
  /** Display name for logging and error messages */
  readonly displayName: string;
  /** Base service type / adapter name (e.g. 'datadog' for both production and staging) */
  readonly adapterName: string;
  /** URL patterns for chrome.tabs.query */
  readonly urlPatterns: string[];
  /** Domain substring for URL matching (e.g. '.slack.com') */
  readonly domain: string;
  /** Strings that indicate authentication failure in error messages */
  readonly authErrorPatterns: string[];
  /** Health check configuration */
  readonly healthCheck: HealthCheckConfig;
  /**
   * Custom health check evaluator. Receives the JSON-RPC response and the
   * authErrorPatterns. Return true if the session is healthy.
   *
   * When omitted, the default evaluator is used: `!('error' in response)`.
   */
  readonly isHealthy?: (response: JsonRpcResponse, authErrorPatterns: string[]) => boolean;
  /** Override for the "not connected" error message */
  readonly notConnectedMessage?: string;
  /** Override for the "tab not found" error message */
  readonly tabNotFoundMessage?: string;
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

export type { ServiceEnv, ServiceDefinition, ServiceId, HealthCheckConfig, WebappServiceConfig };

export {
  getServiceRegistry,
  setServiceRegistry,
  resetServiceRegistry,
  addServiceDefinitions,
  removeServiceDefinitions,
  onRegistryChange,
  getServiceIds,
  getServiceTypes,
  getServiceUrlPatterns,
  getServiceDomains,
  getServiceTimeouts,
  getServiceDisplayNames,
  getSingleEnvServices,
  getServiceType,
  getServiceTypeFromHostname,
  getServiceDefinition,
  getServiceEnv,
  getServiceUrl,
  computeServiceIds,
};
