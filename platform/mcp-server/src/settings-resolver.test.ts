import type { ConfigSchema } from '@opentabs-dev/shared';
import { describe, expect, test } from 'vitest';
import { resolvePluginSettings } from './settings-resolver.js';

describe('resolvePluginSettings', () => {
  test('returns static patterns and homepage when no configSchema or settings', () => {
    const result = resolvePluginSettings('test', ['*://example.com/*'], 'https://example.com', undefined, undefined);
    expect(result.effectiveUrlPatterns).toEqual(['*://example.com/*']);
    expect(result.effectiveHomepage).toBe('https://example.com');
    expect(result.resolvedValues).toEqual({});
    expect(result.instanceMap).toEqual({});
  });

  test('returns static patterns when configSchema exists but no user settings', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const result = resolvePluginSettings('test', ['*://example.com/*'], 'https://example.com', schema, undefined);
    expect(result.effectiveUrlPatterns).toEqual(['*://example.com/*']);
    expect(result.effectiveHomepage).toBe('https://example.com');
    expect(result.resolvedValues).toEqual({});
    expect(result.instanceMap).toEqual({});
  });

  test('derives match pattern from single-instance url map', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: { production: 'https://my-app.example.com/dashboard' } };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual(['*://my-app.example.com/*']);
    expect(result.effectiveHomepage).toBe('https://my-app.example.com/dashboard');
    expect(result.resolvedValues).toEqual({ instanceUrl: { production: 'https://my-app.example.com/dashboard' } });
    expect(result.instanceMap).toEqual({ production: '*://my-app.example.com/*' });
  });

  test('derives match patterns from multi-instance url map', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = {
      instanceUrl: {
        production: 'https://prod.example.com',
        staging: 'https://staging.example.com',
      },
    };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual(['*://prod.example.com/*', '*://staging.example.com/*']);
    expect(result.effectiveHomepage).toBe('https://prod.example.com');
    expect(result.resolvedValues).toEqual({
      instanceUrl: {
        production: 'https://prod.example.com',
        staging: 'https://staging.example.com',
      },
    });
    expect(result.instanceMap).toEqual({
      production: '*://prod.example.com/*',
      staging: '*://staging.example.com/*',
    });
  });

  test('appends derived patterns to static urlPatterns', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: { default: 'https://custom.example.com' } };
    const result = resolvePluginSettings('test', ['*://default.example.com/*'], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual(['*://default.example.com/*', '*://custom.example.com/*']);
  });

  test('static homepage takes precedence over derived homepage', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: { default: 'https://custom.example.com' } };
    const result = resolvePluginSettings('test', [], 'https://static-homepage.example.com', schema, settings);

    expect(result.effectiveHomepage).toBe('https://static-homepage.example.com');
  });

  test('skips invalid URLs within the map and logs warning', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: { broken: 'not-a-url', valid: 'https://valid.example.com' } };
    const result = resolvePluginSettings('test', ['*://fallback.com/*'], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual(['*://fallback.com/*', '*://valid.example.com/*']);
    expect(result.resolvedValues).toEqual({ instanceUrl: { broken: 'not-a-url', valid: 'https://valid.example.com' } });
    expect(result.instanceMap).toEqual({ valid: '*://valid.example.com/*' });
  });

  test('skips non-object values for url-type settings', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: 12345 };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual([]);
    expect(result.resolvedValues).toEqual({});
    expect(result.instanceMap).toEqual({});
  });

  test('skips plain string values for url-type settings', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: 'https://example.com' };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual([]);
    expect(result.resolvedValues).toEqual({});
    expect(result.instanceMap).toEqual({});
  });

  test('skips array values for url-type settings', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: ['https://example.com'] };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual([]);
    expect(result.resolvedValues).toEqual({});
    expect(result.instanceMap).toEqual({});
  });

  test('skips empty url map', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: {} };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual([]);
    expect(result.resolvedValues).toEqual({});
    expect(result.instanceMap).toEqual({});
  });

  test('skips url map entries with empty string URLs', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: { empty: '', valid: 'https://valid.example.com' } };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual(['*://valid.example.com/*']);
    expect(result.instanceMap).toEqual({ valid: '*://valid.example.com/*' });
  });

  test('skips url map entries with non-string URLs', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: { num: 123, valid: 'https://valid.example.com' } };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual(['*://valid.example.com/*']);
    expect(result.instanceMap).toEqual({ valid: '*://valid.example.com/*' });
  });

  test('resolves string-type settings', () => {
    const schema: ConfigSchema = {
      apiKey: { type: 'string', label: 'API Key' },
    };
    const settings = { apiKey: 'my-secret-key' };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.resolvedValues).toEqual({ apiKey: 'my-secret-key' });
  });

  test('resolves number-type settings', () => {
    const schema: ConfigSchema = {
      timeout: { type: 'number', label: 'Timeout' },
    };
    const settings = { timeout: 30 };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.resolvedValues).toEqual({ timeout: 30 });
  });

  test('resolves boolean-type settings', () => {
    const schema: ConfigSchema = {
      verbose: { type: 'boolean', label: 'Verbose' },
    };
    const settings = { verbose: true };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.resolvedValues).toEqual({ verbose: true });
  });

  test('resolves select-type settings with valid option', () => {
    const schema: ConfigSchema = {
      theme: { type: 'select', label: 'Theme', options: ['light', 'dark'] },
    };
    const settings = { theme: 'dark' };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.resolvedValues).toEqual({ theme: 'dark' });
  });

  test('skips select-type settings with invalid option', () => {
    const schema: ConfigSchema = {
      theme: { type: 'select', label: 'Theme', options: ['light', 'dark'] },
    };
    const settings = { theme: 'blue' };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.resolvedValues).toEqual({});
  });

  test('skips settings with wrong value types', () => {
    const schema: ConfigSchema = {
      apiKey: { type: 'string', label: 'API Key' },
      timeout: { type: 'number', label: 'Timeout' },
      verbose: { type: 'boolean', label: 'Verbose' },
    };
    const settings = { apiKey: 123, timeout: 'not-a-number', verbose: 'yes' };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.resolvedValues).toEqual({});
  });

  test('handles multiple url-type settings deriving multiple patterns', () => {
    const schema: ConfigSchema = {
      primaryUrl: { type: 'url', label: 'Primary URL', required: true },
      secondaryUrl: { type: 'url', label: 'Secondary URL' },
    };
    const settings = {
      primaryUrl: { main: 'https://primary.example.com' },
      secondaryUrl: { main: 'https://secondary.example.com' },
    };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual(['*://primary.example.com/*', '*://secondary.example.com/*']);
    expect(result.effectiveHomepage).toBe('https://primary.example.com');
  });

  test('merges instanceMap entries from multiple url-type settings', () => {
    const schema: ConfigSchema = {
      primaryUrl: { type: 'url', label: 'Primary URL', required: true },
      secondaryUrl: { type: 'url', label: 'Secondary URL' },
    };
    const settings = {
      primaryUrl: { alpha: 'https://primary.example.com' },
      secondaryUrl: { beta: 'https://secondary.example.com' },
    };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.instanceMap).toEqual({
      alpha: '*://primary.example.com/*',
      beta: '*://secondary.example.com/*',
    });
  });

  test('later url-type setting overrides instanceMap entry with same name', () => {
    const schema: ConfigSchema = {
      primaryUrl: { type: 'url', label: 'Primary URL', required: true },
      secondaryUrl: { type: 'url', label: 'Secondary URL' },
    };
    const settings = {
      primaryUrl: { shared: 'https://primary.example.com' },
      secondaryUrl: { shared: 'https://secondary.example.com' },
    };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.instanceMap).toEqual({
      shared: '*://secondary.example.com/*',
    });
  });

  test('skips null and undefined setting values', () => {
    const schema: ConfigSchema = {
      apiKey: { type: 'string', label: 'API Key' },
      instanceUrl: { type: 'url', label: 'URL' },
    };
    const settings = { apiKey: null, instanceUrl: undefined } as unknown as Record<string, unknown>;
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.resolvedValues).toEqual({});
  });

  test('ignores user settings not defined in configSchema', () => {
    const schema: ConfigSchema = {
      apiKey: { type: 'string', label: 'API Key' },
    };
    const settings = { apiKey: 'valid', unknownKey: 'ignored' };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.resolvedValues).toEqual({ apiKey: 'valid' });
  });

  test('url map with all invalid URLs produces empty instanceMap', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = { instanceUrl: { bad1: 'not-a-url', bad2: 'also-not-valid' } };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveUrlPatterns).toEqual([]);
    expect(result.resolvedValues).toEqual({});
    expect(result.instanceMap).toEqual({});
  });

  test('homepage is derived from the first valid URL in the map', () => {
    const schema: ConfigSchema = {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    };
    const settings = {
      instanceUrl: {
        alpha: 'https://alpha.example.com/app',
        beta: 'https://beta.example.com/app',
      },
    };
    const result = resolvePluginSettings('test', [], undefined, schema, settings);

    expect(result.effectiveHomepage).toBe('https://alpha.example.com/app');
  });
});
