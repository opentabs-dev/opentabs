import { normalizePluginName, isValidPluginPackageName } from './plugin-management.js';
import { describe, expect, test } from 'bun:test';

describe('normalizePluginName', () => {
  test('shorthand names resolve to official scoped package', () => {
    expect(normalizePluginName('slack')).toBe('@opentabs-dev/opentabs-plugin-slack');
    expect(normalizePluginName('my-tool')).toBe('@opentabs-dev/opentabs-plugin-my-tool');
  });

  test('passes through full unscoped package names unchanged', () => {
    expect(normalizePluginName('opentabs-plugin-slack')).toBe('opentabs-plugin-slack');
  });

  test('passes through scoped package names unchanged', () => {
    expect(normalizePluginName('@my-org/opentabs-plugin-custom')).toBe('@my-org/opentabs-plugin-custom');
    expect(normalizePluginName('@opentabs-dev/opentabs-plugin-slack')).toBe('@opentabs-dev/opentabs-plugin-slack');
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
