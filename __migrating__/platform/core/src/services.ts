// =============================================================================
// Service Types
//
// Defines the shape of a service (plugin) identity. The platform uses these
// types to manage tab lifecycle, URL matching, health checks, and routing.
//
// IMPORTANT: This module defines TYPES and UTILITIES only — no hardcoded
// service data. The actual registry is built dynamically at startup by merging
// built-in platform services with installed plugin definitions.
// =============================================================================

// -----------------------------------------------------------------------------
// Service Identity Types
// -----------------------------------------------------------------------------

/** Environment types for services that support multiple deployments. */
export type ServiceEnv = 'production' | 'staging';

/**
 * A single service definition — the canonical identity of a webapp service.
 *
 * This is the shape that every plugin manifest's `adapter` + `service` sections
 * are transformed into. The platform operates entirely on this type: tab
 * matching, adapter injection, health checks, routing, manifest generation,
 * and UI rendering all derive from ServiceDefinition arrays.
 */
export interface ServiceDefinition {
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
export type ServiceId = string;

// -----------------------------------------------------------------------------
// Service Registry — Dynamic, Built at Startup
// -----------------------------------------------------------------------------

/**
 * The live service registry. Starts empty and is populated during platform
 * initialization by merging built-in definitions with plugin definitions.
 *
 * All modules that need service data import this and call the getter.
 * The registry is frozen after initialization to prevent runtime mutation.
 */
let registry: readonly ServiceDefinition[] = [];

/** Whether the registry has been frozen (initialization complete). */
let registryFrozen = false;

/**
 * Get the current service registry. Returns an empty array before
 * initialization. After initialization, returns the frozen registry.
 */
export const getServiceRegistry = (): readonly ServiceDefinition[] => registry;

/**
 * Replace the service registry contents. Called once during platform
 * initialization after all plugins are discovered and validated.
 *
 * Throws if the registry has already been frozen (double-initialization).
 */
export const setServiceRegistry = (definitions: readonly ServiceDefinition[]): void => {
  if (registryFrozen) {
    throw new Error(
      'Service registry is frozen. setServiceRegistry() can only be called once during initialization.',
    );
  }
  registry = Object.freeze([...definitions]);
  registryFrozen = true;

  // Recompute all derived lookup tables
  recomputeDerivedConstants();
};

/**
 * Reset the registry to empty. Used only in tests.
 */
export const resetServiceRegistry = (): void => {
  registry = [];
  registryFrozen = false;
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
    def.environments.length === 1
      ? [def.type]
      : def.environments.map(env => `${def.type}_${env}`),
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
  _singleEnvServices = registry
    .filter(def => def.environments.length === 1)
    .map(def => def.type);
};

/** All service IDs (e.g. ['slack', 'datadog_production', 'datadog_staging']). */
export const getServiceIds = (): readonly string[] => _serviceIds;

/** All service types (e.g. ['slack', 'datadog']). */
export const getServiceTypes = (): readonly string[] => _serviceTypes;

/** URL patterns keyed by service ID. */
export const getServiceUrlPatterns = (): Readonly<Record<string, string[]>> => _urlPatterns;

/** Domain strings keyed by service ID. */
export const getServiceDomains = (): Readonly<Record<string, string>> => _domains;

/** Request timeout per service type (milliseconds). */
export const getServiceTimeouts = (): Readonly<Record<string, number>> => _timeouts;

/** Human-readable display names keyed by service type. */
export const getServiceDisplayNames = (): Readonly<Record<string, string>> => _displayNames;

/** Service types that have a single environment (no production/staging split). */
export const getSingleEnvServices = (): readonly string[] => _singleEnvServices;

// -----------------------------------------------------------------------------
// Lookup Helpers
// -----------------------------------------------------------------------------

/** Resolve a service ID to its base service type. */
export const getServiceType = (serviceId: string): string | undefined => {
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
export const getServiceTypeFromHostname = (hostname: string): string | undefined => {
  for (const [serviceId, domain] of Object.entries(_domains)) {
    if (hostname.endsWith(domain) || hostname === domain) {
      return getServiceType(serviceId);
    }
  }
  return undefined;
};

/** Get the ServiceDefinition for a service type. */
export const getServiceDefinition = (
  serviceType: string,
): ServiceDefinition | undefined =>
  registry.find(def => def.type === serviceType);

/** Derive the ServiceEnv from a service ID (undefined for single-env services). */
export const getServiceEnv = (serviceId: string): ServiceEnv | undefined => {
  if (serviceId.endsWith('_production')) return 'production';
  if (serviceId.endsWith('_staging')) return 'staging';
  return undefined;
};

/**
 * Get the canonical URL for a service ID (used in side panel links and
 * error messages). For most services this is `https://${domain}`. For
 * services with wildcard domains (leading dot), uses `defaultUrl`.
 */
export const getServiceUrl = (serviceId: string): string => {
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
export const computeServiceIds = (
  definitions: readonly ServiceDefinition[],
): string[] =>
  definitions.flatMap(def =>
    def.environments.length === 1
      ? [def.type]
      : def.environments.map(env => `${def.type}_${env}`),
  );
