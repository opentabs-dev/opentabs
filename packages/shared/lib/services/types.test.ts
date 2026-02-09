import { describe, it, expect } from 'bun:test';
import {
  SERVICE_DOMAINS,
  SERVICE_IDS,
  SERVICE_TYPES,
  SERVICE_REGISTRY,
  SERVICE_TIMEOUTS,
  SERVICE_DISPLAY_NAMES,
  SINGLE_ENV_SERVICES,
  getServiceType,
  getServiceTypeFromHostname,
  getServiceDefinition,
  getServiceEnv,
  getServiceUrl,
} from './types.js';
import type { ServiceId, ServiceType } from './types.js';

describe('SERVICE_REGISTRY', () => {
  it('should have entries for all expected service types', () => {
    const types = SERVICE_REGISTRY.map(def => def.type);
    expect(types).toContain('slack');
    expect(types).toContain('datadog');
    expect(types).toContain('sqlpad');
    expect(types).toContain('logrocket');
    expect(types).toContain('retool');
    expect(types).toContain('snowflake');
  });

  it('should have valid timeouts for all services', () => {
    for (const def of SERVICE_REGISTRY) {
      expect(def.timeout).toBeGreaterThan(0);
    }
  });

  it('should have at least one environment per service', () => {
    for (const def of SERVICE_REGISTRY) {
      expect(def.environments.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should have matching domain and urlPattern keys for each environment', () => {
    for (const def of SERVICE_REGISTRY) {
      for (const env of def.environments) {
        expect(def.domains[env]).toBeDefined();
        expect(def.urlPatterns[env]).toBeDefined();
        expect(def.urlPatterns[env].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('SERVICE_IDS', () => {
  it('should contain all expected service IDs', () => {
    expect(SERVICE_IDS).toContain('slack');
    expect(SERVICE_IDS).toContain('datadog_production');
    expect(SERVICE_IDS).toContain('datadog_staging');
    expect(SERVICE_IDS).toContain('sqlpad_production');
    expect(SERVICE_IDS).toContain('sqlpad_staging');
    expect(SERVICE_IDS).toContain('logrocket');
    expect(SERVICE_IDS).toContain('retool_production');
    expect(SERVICE_IDS).toContain('retool_staging');
    expect(SERVICE_IDS).toContain('snowflake');
  });

  it('should derive count from registry environments', () => {
    const expectedCount = SERVICE_REGISTRY.reduce((sum, def) => sum + def.environments.length, 0);
    expect(SERVICE_IDS.length).toBe(expectedCount);
  });
});

describe('SERVICE_TYPES', () => {
  it('should contain all service types from the registry', () => {
    for (const def of SERVICE_REGISTRY) {
      expect(SERVICE_TYPES).toContain(def.type);
    }
  });

  it('should have the same length as the registry', () => {
    expect(SERVICE_TYPES.length).toBe(SERVICE_REGISTRY.length);
  });
});

describe('SERVICE_DOMAINS', () => {
  it('should have a domain for each service ID', () => {
    for (const serviceId of SERVICE_IDS) {
      expect(SERVICE_DOMAINS[serviceId]).toBeDefined();
      expect(typeof SERVICE_DOMAINS[serviceId]).toBe('string');
    }
  });
});

describe('SERVICE_TIMEOUTS', () => {
  it('should have a timeout for each service type', () => {
    for (const serviceType of SERVICE_TYPES) {
      expect(SERVICE_TIMEOUTS[serviceType]).toBeDefined();
      expect(SERVICE_TIMEOUTS[serviceType]).toBeGreaterThan(0);
    }
  });
});

describe('SERVICE_DISPLAY_NAMES', () => {
  it('should have a display name for each service type', () => {
    for (const serviceType of SERVICE_TYPES) {
      expect(SERVICE_DISPLAY_NAMES[serviceType]).toBeDefined();
      expect(typeof SERVICE_DISPLAY_NAMES[serviceType]).toBe('string');
    }
  });
});

describe('SINGLE_ENV_SERVICES', () => {
  it('should contain only single-environment services', () => {
    for (const serviceType of SINGLE_ENV_SERVICES) {
      const def = SERVICE_REGISTRY.find(d => d.type === serviceType);
      expect(def).toBeDefined();
      expect(def!.environments.length).toBe(1);
    }
  });

  it('should include slack, logrocket, and snowflake', () => {
    expect(SINGLE_ENV_SERVICES).toContain('slack');
    expect(SINGLE_ENV_SERVICES).toContain('logrocket');
    expect(SINGLE_ENV_SERVICES).toContain('snowflake');
  });

  it('should not include multi-env services', () => {
    expect(SINGLE_ENV_SERVICES).not.toContain('datadog');
    expect(SINGLE_ENV_SERVICES).not.toContain('sqlpad');
    expect(SINGLE_ENV_SERVICES).not.toContain('retool');
  });
});

describe('getServiceType', () => {
  it('should return slack for slack service ID', () => {
    expect(getServiceType('slack')).toBe('slack');
  });

  it('should return datadog for datadog service IDs', () => {
    expect(getServiceType('datadog_production')).toBe('datadog');
    expect(getServiceType('datadog_staging')).toBe('datadog');
  });

  it('should return sqlpad for sqlpad service IDs', () => {
    expect(getServiceType('sqlpad_production')).toBe('sqlpad');
    expect(getServiceType('sqlpad_staging')).toBe('sqlpad');
  });

  it('should return logrocket for logrocket service ID', () => {
    expect(getServiceType('logrocket')).toBe('logrocket');
  });

  it('should return retool for retool service IDs', () => {
    expect(getServiceType('retool_production')).toBe('retool');
    expect(getServiceType('retool_staging')).toBe('retool');
  });

  it('should return snowflake for snowflake service ID', () => {
    expect(getServiceType('snowflake')).toBe('snowflake');
  });
});

describe('getServiceTypeFromHostname', () => {
  describe('Slack hostnames', () => {
    it('should match *.slack.com domains', () => {
      expect(getServiceTypeFromHostname('app.slack.com')).toBe('slack');
      expect(getServiceTypeFromHostname('myworkspace.slack.com')).toBe('slack');
      expect(getServiceTypeFromHostname('enterprise.slack.com')).toBe('slack');
    });
  });

  describe('Datadog hostnames', () => {
    it('should match brex-production.datadoghq.com', () => {
      expect(getServiceTypeFromHostname('brex-production.datadoghq.com')).toBe('datadog');
    });

    it('should match brex-staging.datadoghq.com', () => {
      expect(getServiceTypeFromHostname('brex-staging.datadoghq.com')).toBe('datadog');
    });

    it('should not match other datadoghq.com subdomains', () => {
      expect(getServiceTypeFromHostname('other-org.datadoghq.com')).toBe(null);
      expect(getServiceTypeFromHostname('app.datadoghq.com')).toBe(null);
    });
  });

  describe('SQLPad hostnames', () => {
    it('should match sqlpad.production.brexapps.io', () => {
      expect(getServiceTypeFromHostname('sqlpad.production.brexapps.io')).toBe('sqlpad');
    });

    it('should match sqlpad.staging.brexapps.io', () => {
      expect(getServiceTypeFromHostname('sqlpad.staging.brexapps.io')).toBe('sqlpad');
    });

    it('should not match other brexapps.io subdomains', () => {
      expect(getServiceTypeFromHostname('other.brexapps.io')).toBe(null);
      expect(getServiceTypeFromHostname('production.brexapps.io')).toBe(null);
    });
  });

  describe('LogRocket hostnames', () => {
    it('should match app.logrocket.com', () => {
      expect(getServiceTypeFromHostname('app.logrocket.com')).toBe('logrocket');
    });

    it('should not match other logrocket.com subdomains', () => {
      expect(getServiceTypeFromHostname('docs.logrocket.com')).toBe(null);
    });
  });

  describe('Retool hostnames', () => {
    it('should match retool-v3.infra.brexapps.io', () => {
      expect(getServiceTypeFromHostname('retool-v3.infra.brexapps.io')).toBe('retool');
    });

    it('should match retool-v3.staging.infra.brexapps.io', () => {
      expect(getServiceTypeFromHostname('retool-v3.staging.infra.brexapps.io')).toBe('retool');
    });
  });

  describe('Snowflake hostnames', () => {
    it('should match app.snowflake.com', () => {
      expect(getServiceTypeFromHostname('app.snowflake.com')).toBe('snowflake');
    });

    it('should not match other snowflake.com subdomains', () => {
      expect(getServiceTypeFromHostname('docs.snowflake.com')).toBe(null);
    });
  });

  describe('Unknown hostnames', () => {
    it('should return null for unknown domains', () => {
      expect(getServiceTypeFromHostname('google.com')).toBe(null);
      expect(getServiceTypeFromHostname('example.com')).toBe(null);
      expect(getServiceTypeFromHostname('localhost')).toBe(null);
      expect(getServiceTypeFromHostname('')).toBe(null);
    });
  });

  describe('consistency with SERVICE_DOMAINS', () => {
    it('should return correct service type for all SERVICE_DOMAINS values', () => {
      const expectedMapping: Record<ServiceId, ServiceType> = {
        slack: 'slack',
        datadog_production: 'datadog',
        datadog_staging: 'datadog',
        sqlpad_production: 'sqlpad',
        sqlpad_staging: 'sqlpad',
        logrocket: 'logrocket',
        retool_production: 'retool',
        retool_staging: 'retool',
        snowflake: 'snowflake',
      };

      for (const serviceId of SERVICE_IDS) {
        const domain = SERVICE_DOMAINS[serviceId];
        // For domains with leading dot (like .slack.com), test with a subdomain
        const testHostname = domain.startsWith('.') ? `test${domain}` : domain;
        const result = getServiceTypeFromHostname(testHostname);
        expect(result).toBe(expectedMapping[serviceId as ServiceId]);
      }
    });
  });
});

describe('getServiceDefinition', () => {
  it('should return the definition for a known service type', () => {
    const def = getServiceDefinition('slack');
    expect(def).toBeDefined();
    expect(def!.type).toBe('slack');
    expect(def!.displayName).toBe('Slack');
  });

  it('should return undefined for an unknown service type', () => {
    expect(getServiceDefinition('unknown')).toBeUndefined();
  });

  it('should return correct definition for all service types', () => {
    for (const serviceType of SERVICE_TYPES) {
      const def = getServiceDefinition(serviceType);
      expect(def).toBeDefined();
      expect(def!.type).toBe(serviceType);
    }
  });
});

describe('getServiceEnv', () => {
  it('should return production for production-suffixed IDs', () => {
    expect(getServiceEnv('datadog_production')).toBe('production');
    expect(getServiceEnv('sqlpad_production')).toBe('production');
    expect(getServiceEnv('retool_production')).toBe('production');
  });

  it('should return staging for staging-suffixed IDs', () => {
    expect(getServiceEnv('datadog_staging')).toBe('staging');
    expect(getServiceEnv('sqlpad_staging')).toBe('staging');
    expect(getServiceEnv('retool_staging')).toBe('staging');
  });

  it('should return undefined for single-env service IDs', () => {
    expect(getServiceEnv('slack')).toBeUndefined();
    expect(getServiceEnv('logrocket')).toBeUndefined();
    expect(getServiceEnv('snowflake')).toBeUndefined();
  });
});

describe('getServiceUrl', () => {
  it('should return defaultUrl for services with leading-dot domains', () => {
    // Slack has domain '.slack.com' and defaultUrl 'https://brex.slack.com'
    expect(getServiceUrl('slack')).toBe('https://brex.slack.com');
  });

  it('should derive URL from domain for standard services', () => {
    expect(getServiceUrl('datadog_production')).toBe('https://brex-production.datadoghq.com');
    expect(getServiceUrl('logrocket')).toBe('https://app.logrocket.com');
    expect(getServiceUrl('snowflake')).toBe('https://app.snowflake.com');
  });

  it('should return correct URLs for staging environments', () => {
    expect(getServiceUrl('datadog_staging')).toBe('https://brex-staging.datadoghq.com');
    expect(getServiceUrl('sqlpad_staging')).toBe('https://sqlpad.staging.brexapps.io');
    expect(getServiceUrl('retool_staging')).toBe('https://retool-v3.staging.infra.brexapps.io');
  });

  it('should return # for unknown service IDs', () => {
    expect(getServiceUrl('unknown_service')).toBe('#');
  });
});
