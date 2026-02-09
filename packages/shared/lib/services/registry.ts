/**
 * Centralized Service Registry
 *
 * Single source of truth for all webapp service identity data. Every other
 * module that needs service names, domains, URL patterns, timeouts, or display
 * names imports from here instead of maintaining its own copy.
 *
 * To add a new service, add one entry to SERVICE_REGISTRY. Everything else
 * (types, constants, manifest entries, adapter configs, side panel items) is
 * derived automatically.
 */

// ============================================================================
// Types
// ============================================================================

/** Environment types for multi-environment services */
type ServiceEnv = 'production' | 'staging';

/** A single service definition in the registry */
interface ServiceDefinition {
  /** Base service type (e.g. 'slack', 'datadog') — used as the adapter name and routing key */
  type: string;
  /** Human-readable display name */
  displayName: string;
  /** Environments this service supports */
  environments: readonly ServiceEnv[];
  /** Domain strings keyed by environment (used for URL matching and hostname lookup) */
  domains: Readonly<Record<string, string>>;
  /** URL patterns keyed by environment (used for chrome.tabs.query and manifest) */
  urlPatterns: Readonly<Record<string, readonly string[]>>;
  /** Icon filename (without extension) in the extension's icons directory */
  iconName: string;
  /** MCP request timeout in milliseconds */
  timeout: number;
  /**
   * Canonical URL for the service. Only needed when the production domain
   * has a leading dot (e.g. '.slack.com') and can't be turned into a URL
   * directly. For all other services, the URL is derived as
   * `https://${production_domain}`.
   */
  defaultUrl?: string;
  /**
   * Host permission patterns for the manifest. When omitted, derived from
   * urlPatterns by replacing `*://` with `https://`.
   */
  hostPermissions?: readonly string[];
}

// ============================================================================
// Registry
// ============================================================================

const SERVICE_REGISTRY: readonly ServiceDefinition[] = [
  {
    type: 'slack',
    displayName: 'Slack',
    environments: ['production'],
    domains: { production: '.slack.com' },
    urlPatterns: { production: ['*://*.slack.com/*'] },
    hostPermissions: ['https://*.slack.com/*', 'https://edgeapi.slack.com/*'],
    iconName: 'slack',
    timeout: 30000,
    defaultUrl: 'https://brex.slack.com',
  },
  {
    type: 'datadog',
    displayName: 'Datadog',
    environments: ['production', 'staging'],
    domains: {
      production: 'brex-production.datadoghq.com',
      staging: 'brex-staging.datadoghq.com',
    },
    urlPatterns: {
      production: ['*://brex-production.datadoghq.com/*'],
      staging: ['*://brex-staging.datadoghq.com/*'],
    },
    hostPermissions: ['https://*.datadoghq.com/*'],
    iconName: 'datadog',
    timeout: 60000,
  },
  {
    type: 'sqlpad',
    displayName: 'SQLPad',
    environments: ['production', 'staging'],
    domains: {
      production: 'sqlpad.production.brexapps.io',
      staging: 'sqlpad.staging.brexapps.io',
    },
    urlPatterns: {
      production: ['*://sqlpad.production.brexapps.io/*'],
      staging: ['*://sqlpad.staging.brexapps.io/*'],
    },
    iconName: 'sqlpad',
    timeout: 60000,
  },
  {
    type: 'logrocket',
    displayName: 'LogRocket',
    environments: ['production'],
    domains: { production: 'app.logrocket.com' },
    urlPatterns: { production: ['*://app.logrocket.com/*'] },
    iconName: 'logrocket',
    timeout: 60000,
  },
  {
    type: 'retool',
    displayName: 'Retool',
    environments: ['production', 'staging'],
    domains: {
      production: 'retool-v3.infra.brexapps.io',
      staging: 'retool-v3.staging.infra.brexapps.io',
    },
    urlPatterns: {
      production: ['*://retool-v3.infra.brexapps.io/*'],
      staging: ['*://retool-v3.staging.infra.brexapps.io/*'],
    },
    iconName: 'retool',
    timeout: 60000,
  },
  {
    type: 'snowflake',
    displayName: 'Snowflake',
    environments: ['production'],
    domains: { production: 'app.snowflake.com' },
    urlPatterns: { production: ['*://app.snowflake.com/*'] },
    iconName: 'snowflake',
    timeout: 300000,
  },
] as const;

// ============================================================================
// Derived Constants
// ============================================================================

/** Service types derived from the registry */
type ServiceType = (typeof SERVICE_REGISTRY)[number]['type'];

/**
 * All service IDs. Single-env services use the type directly (e.g. 'slack').
 * Multi-env services get suffixed (e.g. 'datadog_production', 'datadog_staging').
 */
const SERVICE_IDS = SERVICE_REGISTRY.flatMap(def =>
  def.environments.length === 1 ? [def.type] : def.environments.map(env => `${def.type}_${env}`),
);

type ServiceId = (typeof SERVICE_IDS)[number];

/** All service types as an array */
const SERVICE_TYPES: ServiceType[] = SERVICE_REGISTRY.map(def => def.type);

/** URL patterns keyed by ServiceId */
const SERVICE_URL_PATTERNS: Record<string, string[]> = {};
for (const def of SERVICE_REGISTRY) {
  if (def.environments.length === 1) {
    SERVICE_URL_PATTERNS[def.type] = [...def.urlPatterns[def.environments[0]]];
  } else {
    for (const env of def.environments) {
      SERVICE_URL_PATTERNS[`${def.type}_${env}`] = [...def.urlPatterns[env]];
    }
  }
}

/** Domain strings keyed by ServiceId */
const SERVICE_DOMAINS: Record<string, string> = {};
for (const def of SERVICE_REGISTRY) {
  if (def.environments.length === 1) {
    SERVICE_DOMAINS[def.type] = def.domains[def.environments[0]];
  } else {
    for (const env of def.environments) {
      SERVICE_DOMAINS[`${def.type}_${env}`] = def.domains[env];
    }
  }
}

/** Request timeout per ServiceType (milliseconds) */
const SERVICE_TIMEOUTS: Record<string, number> = Object.fromEntries(
  SERVICE_REGISTRY.map(def => [def.type, def.timeout]),
);

/** Human-readable display names keyed by ServiceType (e.g. 'Slack', 'Datadog') */
const SERVICE_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  SERVICE_REGISTRY.map(def => [def.type, def.displayName]),
);

/** Service types that have a single environment (no production/staging split) */
const SINGLE_ENV_SERVICES: ServiceType[] = SERVICE_REGISTRY.filter(def => def.environments.length === 1).map(
  def => def.type,
);

// ============================================================================
// Lookup Helpers
// ============================================================================

/** Map from ServiceId to its base ServiceType */
const getServiceType = (serviceId: string): ServiceType => {
  // Direct match (single-env services)
  const direct = SERVICE_REGISTRY.find(def => def.type === serviceId);
  if (direct) return direct.type;

  // Extract type from env-suffixed ID
  for (const def of SERVICE_REGISTRY) {
    if (def.environments.length > 1) {
      for (const env of def.environments) {
        if (serviceId === `${def.type}_${env}`) return def.type;
      }
    }
  }

  // Fallback (should not happen with correct types)
  return SERVICE_REGISTRY[0].type;
};

/** Reverse lookup: hostname → ServiceType (null if no match) */
const getServiceTypeFromHostname = (hostname: string): ServiceType | null => {
  for (const [serviceId, domain] of Object.entries(SERVICE_DOMAINS)) {
    if (hostname.endsWith(domain) || hostname === domain) {
      return getServiceType(serviceId);
    }
  }
  return null;
};

/** Get the ServiceDefinition for a ServiceType */
const getServiceDefinition = (serviceType: string): ServiceDefinition | undefined =>
  SERVICE_REGISTRY.find(def => def.type === serviceType);

/** Derive the ServiceEnv from a ServiceId (returns undefined for single-env services) */
const getServiceEnv = (serviceId: string): ServiceEnv | undefined => {
  if (serviceId.endsWith('_production')) return 'production';
  if (serviceId.endsWith('_staging')) return 'staging';
  return undefined;
};

/**
 * Get the canonical URL for a ServiceId (used by side panel and error messages).
 * For most services this is `https://${domain}`. For services with wildcard
 * domains (leading dot, e.g. '.slack.com'), uses the `defaultUrl` from the
 * registry.
 */
const getServiceUrl = (serviceId: string): string => {
  const domain = SERVICE_DOMAINS[serviceId];
  if (!domain) return '#';
  if (domain.startsWith('.')) {
    const def = getServiceDefinition(getServiceType(serviceId));
    return def?.defaultUrl ?? `https://${domain.slice(1)}`;
  }
  return `https://${domain}`;
};

// ============================================================================
// Exports
// ============================================================================

export {
  SERVICE_REGISTRY,
  SERVICE_IDS,
  SERVICE_TYPES,
  SERVICE_URL_PATTERNS,
  SERVICE_DOMAINS,
  SERVICE_TIMEOUTS,
  SERVICE_DISPLAY_NAMES,
  SINGLE_ENV_SERVICES,
  getServiceType,
  getServiceTypeFromHostname,
  getServiceDefinition,
  getServiceEnv,
  getServiceUrl,
};

export type { ServiceDefinition, ServiceType, ServiceId, ServiceEnv };
