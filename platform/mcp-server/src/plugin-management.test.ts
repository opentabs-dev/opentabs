import { normalizePluginName, isValidPluginPackageName } from './plugin-management.js';
import { describe, expect, test } from 'bun:test';

describe('normalizePluginName', () => {
  test('prefixes shorthand names with opentabs-plugin-', () => {
    expect(normalizePluginName('slack')).toBe('opentabs-plugin-slack');
    expect(normalizePluginName('my-tool')).toBe('opentabs-plugin-my-tool');
  });

  test('passes through full package names unchanged', () => {
    expect(normalizePluginName('opentabs-plugin-slack')).toBe('opentabs-plugin-slack');
  });

  test('passes through scoped package names unchanged', () => {
    expect(normalizePluginName('@my-org/opentabs-plugin-custom')).toBe('@my-org/opentabs-plugin-custom');
  });
});

describe('isValidPluginPackageName', () => {
  test('accepts opentabs-plugin-* names', () => {
    expect(isValidPluginPackageName('opentabs-plugin-slack')).toBe(true);
    expect(isValidPluginPackageName('opentabs-plugin-my-tool')).toBe(true);
  });

  test('accepts scoped opentabs-plugin-* names', () => {
    expect(isValidPluginPackageName('@my-org/opentabs-plugin-custom')).toBe(true);
    expect(isValidPluginPackageName('@opentabs-dev/opentabs-plugin-slack')).toBe(true);
  });

  test('rejects bare opentabs-plugin- prefix with no suffix', () => {
    expect(isValidPluginPackageName('opentabs-plugin-')).toBe(false);
  });

  test('rejects names that do not match the plugin pattern', () => {
    expect(isValidPluginPackageName('some-random-package')).toBe(false);
    expect(isValidPluginPackageName('slack')).toBe(false);
  });

  test('rejects scoped names without opentabs-plugin- pattern', () => {
    expect(isValidPluginPackageName('@my-org/random-package')).toBe(false);
  });
});
