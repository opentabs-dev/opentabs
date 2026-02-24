import { normalizePluginName, resolvePluginPackageCandidates, OFFICIAL_SCOPE, PLUGIN_PREFIX } from './constants.js';
import { describe, expect, test } from 'bun:test';

describe('OFFICIAL_SCOPE', () => {
  test('is @opentabs-dev', () => {
    expect(OFFICIAL_SCOPE).toBe('@opentabs-dev');
  });
});

describe('PLUGIN_PREFIX', () => {
  test('is opentabs-plugin-', () => {
    expect(PLUGIN_PREFIX).toBe('opentabs-plugin-');
  });
});

describe('normalizePluginName', () => {
  test('shorthand name resolves to official scoped package', () => {
    expect(normalizePluginName('slack')).toBe('@opentabs-dev/opentabs-plugin-slack');
  });

  test('multi-word shorthand name resolves to official scoped package', () => {
    expect(normalizePluginName('my-tool')).toBe('@opentabs-dev/opentabs-plugin-my-tool');
  });

  test('full unscoped name passes through unchanged', () => {
    expect(normalizePluginName('opentabs-plugin-slack')).toBe('opentabs-plugin-slack');
  });

  test('official scoped name passes through unchanged', () => {
    expect(normalizePluginName('@opentabs-dev/opentabs-plugin-slack')).toBe('@opentabs-dev/opentabs-plugin-slack');
  });

  test('third-party scoped name passes through unchanged', () => {
    expect(normalizePluginName('@my-org/opentabs-plugin-custom')).toBe('@my-org/opentabs-plugin-custom');
  });

  test('scoped name without plugin prefix passes through unchanged', () => {
    expect(normalizePluginName('@my-org/some-package')).toBe('@my-org/some-package');
  });
});

describe('resolvePluginPackageCandidates', () => {
  test('shorthand returns official and community candidates in order', () => {
    expect(resolvePluginPackageCandidates('slack')).toEqual([
      '@opentabs-dev/opentabs-plugin-slack',
      'opentabs-plugin-slack',
    ]);
  });

  test('multi-word shorthand returns both candidates', () => {
    expect(resolvePluginPackageCandidates('my-cool-tool')).toEqual([
      '@opentabs-dev/opentabs-plugin-my-cool-tool',
      'opentabs-plugin-my-cool-tool',
    ]);
  });

  test('full unscoped name returns as single candidate', () => {
    expect(resolvePluginPackageCandidates('opentabs-plugin-slack')).toEqual(['opentabs-plugin-slack']);
  });

  test('official scoped name returns as single candidate', () => {
    expect(resolvePluginPackageCandidates('@opentabs-dev/opentabs-plugin-slack')).toEqual([
      '@opentabs-dev/opentabs-plugin-slack',
    ]);
  });

  test('third-party scoped name returns as single candidate', () => {
    expect(resolvePluginPackageCandidates('@my-org/opentabs-plugin-jira')).toEqual(['@my-org/opentabs-plugin-jira']);
  });

  test('scoped name without plugin prefix returns as single candidate', () => {
    expect(resolvePluginPackageCandidates('@company/some-package')).toEqual(['@company/some-package']);
  });

  test('first candidate matches normalizePluginName result', () => {
    const names = ['slack', 'my-tool', 'opentabs-plugin-slack', '@org/opentabs-plugin-foo'];
    for (const name of names) {
      const candidates = resolvePluginPackageCandidates(name);
      expect(candidates[0]).toBe(normalizePluginName(name));
    }
  });
});
