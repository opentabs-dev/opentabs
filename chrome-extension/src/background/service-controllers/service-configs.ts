/**
 * Declarative service configurations — each webapp service is defined as pure
 * data. The generic WebappServiceController reads these configs at construction
 * time, eliminating the need for per-service controller subclasses.
 *
 * Most configs are derived automatically from the centralized SERVICE_REGISTRY.
 * Only service-specific overrides (custom health checks, auth error patterns)
 * are defined here.
 */

import { SERVICE_REGISTRY, SERVICE_URL_PATTERNS, SERVICE_DOMAINS, isJsonRpcError } from '@extension/shared';
import type { WebappServiceConfig } from './webapp-service-controller';
import type { ServiceId, ServiceEnv, ServiceType, ServiceDefinition } from '@extension/shared';

// ============================================================================
// Shared auth patterns
// ============================================================================

const DEFAULT_HTTP_AUTH_PATTERNS = ['401', '403', 'Unauthorized', 'Forbidden'];

// ============================================================================
// Per-service overrides (only the parts that differ from the default)
// ============================================================================

interface ServiceOverride {
  authErrorPatterns: string[];
  healthCheck: WebappServiceConfig['healthCheck'];
  isHealthy?: WebappServiceConfig['isHealthy'];
}

/** Overrides keyed by ServiceType */
const SERVICE_OVERRIDES: Record<string, ServiceOverride> = {
  slack: {
    authErrorPatterns: ['invalid_auth', 'not_authed', 'token_revoked', 'Not authenticated'],
    healthCheck: {
      method: 'slack.api',
      params: { method: 'auth.test', params: {} },
    },
    isHealthy: (response, authErrorPatterns) => {
      if (isJsonRpcError(response)) return false;

      // Slack API wraps its own errors inside a successful JSON-RPC response
      const data = response.result as { ok?: boolean; error?: string } | undefined;
      if (data && data.ok === false) {
        const error = data.error || '';
        if (authErrorPatterns.some(p => error.includes(p))) {
          console.log('[OpenTabs] Slack session expired:', error);
        }
        return false;
      }

      return true;
    },
  },
  datadog: {
    authErrorPatterns: DEFAULT_HTTP_AUTH_PATTERNS,
    healthCheck: {
      method: 'datadog.api',
      params: { endpoint: '/api/v2/team', method: 'GET', params: { 'page[size]': '1' } },
    },
  },
  sqlpad: {
    authErrorPatterns: ['401', '403', 'Unauthorized', 'Not authenticated'],
    healthCheck: {
      method: 'sqlpad.api',
      params: { endpoint: '/api/connections', method: 'GET' },
    },
  },
  logrocket: {
    authErrorPatterns: [...DEFAULT_HTTP_AUTH_PATTERNS, 'Not authenticated'],
    healthCheck: {
      method: 'logrocket.api',
      params: { endpoint: '/orgs/', method: 'GET' },
    },
  },
  retool: {
    authErrorPatterns: [...DEFAULT_HTTP_AUTH_PATTERNS, 'Not authenticated'],
    healthCheck: {
      method: 'retool.api',
      params: { endpoint: '/api/user', method: 'GET' },
    },
  },
  snowflake: {
    authErrorPatterns: ['401', '403', 'Unauthorized', 'Forbidden', 'SESSION_EXPIRED'],
    healthCheck: {
      // Snowflake uses an internal transport (nufetch); check
      // window.numeracy.pageState.user instead of a REST endpoint.
      method: 'snowflake.healthCheck',
      params: {},
    },
    isHealthy: response => {
      if ('error' in response) return false;
      const result = (response as { result?: { user?: boolean } }).result;
      return !!result?.user;
    },
  },
};

// ============================================================================
// Config builder
// ============================================================================

/**
 * Build a WebappServiceConfig for a specific ServiceId from the registry
 * definition and any per-service overrides.
 */
const buildConfigForServiceId = (serviceId: string, def: ServiceDefinition, env?: ServiceEnv): WebappServiceConfig => {
  const override = SERVICE_OVERRIDES[def.type];
  const displayName =
    env && def.environments.length > 1
      ? `${def.displayName} ${env === 'production' ? 'Production' : 'Staging'}`
      : def.displayName;

  return {
    serviceId: serviceId as ServiceId,
    displayName,
    adapterName: def.type as ServiceType,
    urlPatterns: SERVICE_URL_PATTERNS[serviceId],
    domain: SERVICE_DOMAINS[serviceId],
    authErrorPatterns: override?.authErrorPatterns ?? DEFAULT_HTTP_AUTH_PATTERNS,
    healthCheck: override?.healthCheck ?? {
      method: `${def.type}.api`,
      params: { endpoint: '/health', method: 'GET' },
    },
    ...(override?.isHealthy && { isHealthy: override.isHealthy }),
  };
};

/**
 * Build all WebappServiceConfigs from the registry.
 * Returns a Record<ServiceId, WebappServiceConfig> covering every service-environment.
 */
const buildServiceConfigs = (): Record<string, WebappServiceConfig> => {
  const configs: Record<string, WebappServiceConfig> = {};

  for (const def of SERVICE_REGISTRY) {
    if (def.environments.length === 1) {
      configs[def.type] = buildConfigForServiceId(def.type, def);
    } else {
      for (const env of def.environments) {
        const serviceId = `${def.type}_${env}`;
        configs[serviceId] = buildConfigForServiceId(serviceId, def, env);
      }
    }
  }

  return configs;
};

// ============================================================================
// Exports
// ============================================================================

export { buildServiceConfigs };
