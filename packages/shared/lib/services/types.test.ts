import { describe, it, expect } from 'bun:test';
import {
  SERVICE_DOMAINS,
  SERVICE_IDS,
  getServiceType,
  getServiceTypeFromHostname,
  type ServiceId,
  type ServiceType,
} from './types.js';

describe('SERVICE_DOMAINS', () => {
  it('should have a domain for each service ID', () => {
    for (const serviceId of SERVICE_IDS) {
      expect(SERVICE_DOMAINS[serviceId]).toBeDefined();
      expect(typeof SERVICE_DOMAINS[serviceId]).toBe('string');
    }
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
        expect(result).toBe(expectedMapping[serviceId]);
      }
    });
  });
});
