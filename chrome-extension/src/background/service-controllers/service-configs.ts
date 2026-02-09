/**
 * Declarative service configurations — each webapp service is defined as pure
 * data. The generic WebappServiceController reads these configs at construction
 * time, eliminating the need for per-service controller subclasses.
 *
 * To add a new service: add a config here, wire it in background/index.ts,
 * and create the adapter script. No new controller class is needed.
 */

import { SERVICE_URL_PATTERNS, SERVICE_DOMAINS, isJsonRpcError } from '@extension/shared';
import type { WebappServiceConfig } from './webapp-service-controller';
import type { ServiceId, ServiceEnv } from '@extension/shared';

// ============================================================================
// Multi-environment config helper
// ============================================================================

/**
 * Build a WebappServiceConfig for a multi-environment service. Derives
 * serviceId, displayName, domain, and urlPatterns from the base name + env.
 */
const createMultiEnvConfig = (
  baseName: string,
  adapterName: WebappServiceConfig['adapterName'],
  env: ServiceEnv,
  overrides: Pick<WebappServiceConfig, 'authErrorPatterns' | 'healthCheck'> &
    Partial<Pick<WebappServiceConfig, 'isHealthy' | 'notConnectedMessage' | 'tabNotFoundMessage'>>,
): WebappServiceConfig => {
  const serviceId = `${adapterName}_${env}` as ServiceId;
  const displayName = `${baseName} ${env === 'production' ? 'Production' : 'Staging'}`;
  return {
    serviceId,
    displayName,
    adapterName,
    urlPatterns: SERVICE_URL_PATTERNS[serviceId],
    domain: SERVICE_DOMAINS[serviceId],
    ...overrides,
  };
};

// ============================================================================
// Shared auth patterns
// ============================================================================

const DEFAULT_HTTP_AUTH_PATTERNS = ['401', '403', 'Unauthorized', 'Forbidden'];

// ============================================================================
// Service configs
// ============================================================================

const SLACK_CONFIG: WebappServiceConfig = {
  serviceId: 'slack',
  displayName: 'Slack',
  adapterName: 'slack',
  urlPatterns: SERVICE_URL_PATTERNS.slack,
  domain: SERVICE_DOMAINS.slack,
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
  notConnectedMessage: 'No Slack tab found. Please open https://brex.slack.com in a browser tab.',
  tabNotFoundMessage: 'Slack tab not found. Please open https://brex.slack.com in a browser tab and try again.',
};

const createDatadogConfig = (env: ServiceEnv): WebappServiceConfig =>
  createMultiEnvConfig('Datadog', 'datadog', env, {
    authErrorPatterns: DEFAULT_HTTP_AUTH_PATTERNS,
    healthCheck: {
      method: 'datadog.api',
      params: { endpoint: '/api/v2/team', method: 'GET', params: { 'page[size]': '1' } },
    },
  });

const createSqlpadConfig = (env: ServiceEnv): WebappServiceConfig =>
  createMultiEnvConfig('SQLPad', 'sqlpad', env, {
    authErrorPatterns: ['401', '403', 'Unauthorized', 'Not authenticated'],
    healthCheck: {
      method: 'sqlpad.api',
      params: { endpoint: '/api/connections', method: 'GET' },
    },
  });

const LOGROCKET_CONFIG: WebappServiceConfig = {
  serviceId: 'logrocket',
  displayName: 'LogRocket',
  adapterName: 'logrocket',
  urlPatterns: SERVICE_URL_PATTERNS.logrocket,
  domain: SERVICE_DOMAINS.logrocket,
  authErrorPatterns: [...DEFAULT_HTTP_AUTH_PATTERNS, 'Not authenticated'],
  healthCheck: {
    method: 'logrocket.api',
    params: { endpoint: '/orgs/', method: 'GET' },
  },
  notConnectedMessage:
    'No LogRocket tab found. Please open LogRocket (app.logrocket.com) in a browser tab and ensure you are logged in.',
};

const createRetoolConfig = (env: ServiceEnv): WebappServiceConfig =>
  createMultiEnvConfig('Retool', 'retool', env, {
    authErrorPatterns: [...DEFAULT_HTTP_AUTH_PATTERNS, 'Not authenticated'],
    healthCheck: {
      method: 'retool.api',
      params: { endpoint: '/api/user', method: 'GET' },
    },
  });

const SNOWFLAKE_CONFIG: WebappServiceConfig = {
  serviceId: 'snowflake',
  displayName: 'Snowflake',
  adapterName: 'snowflake',
  urlPatterns: SERVICE_URL_PATTERNS.snowflake,
  domain: SERVICE_DOMAINS.snowflake,
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
  notConnectedMessage:
    'No Snowflake tab found. Please open Snowflake (app.snowflake.com) in a browser tab and ensure you are logged in.',
};

// ============================================================================
// Exports
// ============================================================================

export {
  SLACK_CONFIG,
  LOGROCKET_CONFIG,
  SNOWFLAKE_CONFIG,
  createDatadogConfig,
  createSqlpadConfig,
  createRetoolConfig,
};
