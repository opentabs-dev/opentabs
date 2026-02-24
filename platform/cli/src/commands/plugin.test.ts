import { buildDirectLookupCandidates } from './plugin.js';
import { normalizePluginName, resolvePluginPackageCandidates } from '@opentabs-dev/shared';
import { describe, expect, test } from 'bun:test';

describe('buildDirectLookupCandidates', () => {
  test('returns empty array when no query is provided', () => {
    expect(buildDirectLookupCandidates()).toEqual([]);
    expect(buildDirectLookupCandidates(undefined)).toEqual([]);
  });

  test('returns official and community candidates for a shorthand query', () => {
    expect(buildDirectLookupCandidates('slack')).toEqual([
      '@opentabs-dev/opentabs-plugin-slack',
      'opentabs-plugin-slack',
    ]);
  });

  test('returns multi-word shorthand candidates', () => {
    expect(buildDirectLookupCandidates('my-tool')).toEqual([
      '@opentabs-dev/opentabs-plugin-my-tool',
      'opentabs-plugin-my-tool',
    ]);
  });

  test('returns scoped name as-is when query starts with @', () => {
    expect(buildDirectLookupCandidates('@my-org/opentabs-plugin-jira')).toEqual(['@my-org/opentabs-plugin-jira']);
  });

  test('returns full unscoped name as-is when query starts with opentabs-plugin-', () => {
    expect(buildDirectLookupCandidates('opentabs-plugin-slack')).toEqual(['opentabs-plugin-slack']);
  });
});

describe('normalizePluginName (re-exported from shared)', () => {
  test('shorthand "slack" maps to official scoped package', () => {
    expect(normalizePluginName('slack')).toBe('@opentabs-dev/opentabs-plugin-slack');
  });

  test('full name passes through', () => {
    expect(normalizePluginName('opentabs-plugin-slack')).toBe('opentabs-plugin-slack');
  });

  test('scoped name passes through', () => {
    expect(normalizePluginName('@company/opentabs-plugin-foo')).toBe('@company/opentabs-plugin-foo');
  });
});

describe('resolvePluginPackageCandidates (re-exported from shared)', () => {
  test('shorthand returns two candidates: official first, then community', () => {
    const candidates = resolvePluginPackageCandidates('slack');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe('@opentabs-dev/opentabs-plugin-slack');
    expect(candidates[1]).toBe('opentabs-plugin-slack');
  });

  test('already-qualified names return single candidate', () => {
    expect(resolvePluginPackageCandidates('opentabs-plugin-slack')).toHaveLength(1);
    expect(resolvePluginPackageCandidates('@opentabs-dev/opentabs-plugin-slack')).toHaveLength(1);
    expect(resolvePluginPackageCandidates('@myorg/opentabs-plugin-jira')).toHaveLength(1);
  });
});
