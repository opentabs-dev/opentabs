import { parsePluginPackageJson, isValidPluginPackageName } from './manifest.js';
import { isErr, isOk, unwrap } from './result.js';
import { describe, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import type { Result } from './result.js';

const validPackageJson = {
  name: 'opentabs-plugin-slack',
  version: '1.0.0',
  main: 'dist/adapter.iife.js',
  opentabs: {
    displayName: 'Slack',
    description: 'Slack integration for OpenTabs',
    urlPatterns: ['*://*.slack.com/*'],
  },
};

const sourcePath = path.join(os.tmpdir(), 'test-plugin', 'package.json');

/** Extract the error from a Result that is expected to be Err, failing the test if it's Ok */
const expectErr = <T, E>(result: Result<T, E>): E => {
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('unreachable');
  return result.error;
};

describe('parsePluginPackageJson', () => {
  describe('valid inputs', () => {
    test('parses a valid package.json with all required fields', () => {
      const result = parsePluginPackageJson(validPackageJson, sourcePath);
      expect(isOk(result)).toBe(true);
      expect(unwrap(result)).toEqual({
        name: 'opentabs-plugin-slack',
        version: '1.0.0',
        main: 'dist/adapter.iife.js',
        opentabs: {
          displayName: 'Slack',
          description: 'Slack integration for OpenTabs',
          urlPatterns: ['*://*.slack.com/*'],
        },
      });
    });

    test('parses a scoped package name', () => {
      const json = { ...validPackageJson, name: '@myorg/opentabs-plugin-foo' };
      const result = parsePluginPackageJson(json, sourcePath);
      expect(isOk(result)).toBe(true);
      expect(unwrap(result).name).toBe('@myorg/opentabs-plugin-foo');
    });

    test('parses with multiple URL patterns', () => {
      const json = {
        ...validPackageJson,
        opentabs: {
          ...validPackageJson.opentabs,
          urlPatterns: ['*://*.slack.com/*', '*://app.slack.com/*'],
        },
      };
      const result = parsePluginPackageJson(json, sourcePath);
      expect(isOk(result)).toBe(true);
      expect(unwrap(result).opentabs.urlPatterns).toEqual(['*://*.slack.com/*', '*://app.slack.com/*']);
    });

    test('ignores extra unknown fields at the top level', () => {
      const json = {
        ...validPackageJson,
        license: 'MIT',
        author: 'Test Author',
        dependencies: { foo: '1.0.0' },
      };
      const result = parsePluginPackageJson(json, sourcePath);
      expect(isOk(result)).toBe(true);
      const parsed = unwrap(result);
      expect(parsed.name).toBe('opentabs-plugin-slack');
      expect((parsed as unknown as Record<string, unknown>).license).toBeUndefined();
    });

    test('ignores extra unknown fields in the opentabs field', () => {
      const json = {
        ...validPackageJson,
        opentabs: {
          ...validPackageJson.opentabs,
          icon: 'slack.png',
          category: 'communication',
        },
      };
      const result = parsePluginPackageJson(json, sourcePath);
      expect(isOk(result)).toBe(true);
      const parsed = unwrap(result);
      expect(parsed.opentabs.displayName).toBe('Slack');
      expect((parsed.opentabs as unknown as Record<string, unknown>).icon).toBeUndefined();
    });
  });

  describe('top-level validation', () => {
    test('rejects non-object input (null)', () => {
      const error = expectErr(parsePluginPackageJson(null, sourcePath));
      expect(error).toContain('expected an object');
    });

    test('rejects non-object input (string)', () => {
      const error = expectErr(parsePluginPackageJson('not an object', sourcePath));
      expect(error).toContain('expected an object');
    });

    test('rejects non-object input (array)', () => {
      const error = expectErr(parsePluginPackageJson([], sourcePath));
      expect(error).toContain('expected an object');
    });

    test('rejects non-object input (number)', () => {
      const error = expectErr(parsePluginPackageJson(42, sourcePath));
      expect(error).toContain('expected an object');
    });
  });

  describe('name validation', () => {
    test('rejects missing name', () => {
      const { name: _, ...json } = validPackageJson;
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"name" must be a non-empty string');
    });

    test('rejects empty name', () => {
      const json = { ...validPackageJson, name: '' };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"name" must be a non-empty string');
    });

    test('rejects non-string name', () => {
      const json = { ...validPackageJson, name: 123 };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"name" must be a non-empty string');
    });

    test('rejects name that does not match plugin naming convention', () => {
      const json = { ...validPackageJson, name: 'my-regular-package' };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('must start with "opentabs-plugin-"');
    });

    test('rejects scoped package without opentabs-plugin- prefix', () => {
      const json = { ...validPackageJson, name: '@org/my-package' };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('must start with "opentabs-plugin-"');
    });
  });

  describe('version validation', () => {
    test('rejects missing version', () => {
      const { version: _, ...json } = validPackageJson;
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"version" must be a non-empty string');
    });

    test('rejects empty version', () => {
      const json = { ...validPackageJson, version: '' };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"version" must be a non-empty string');
    });

    test('rejects non-string version', () => {
      const json = { ...validPackageJson, version: 1 };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"version" must be a non-empty string');
    });
  });

  describe('main validation', () => {
    test('rejects missing main', () => {
      const { main: _, ...json } = validPackageJson;
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"main" must be a non-empty string');
    });

    test('rejects empty main', () => {
      const json = { ...validPackageJson, main: '' };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"main" must be a non-empty string');
    });

    test('rejects non-string main', () => {
      const json = { ...validPackageJson, main: true };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"main" must be a non-empty string');
    });
  });

  describe('opentabs field validation', () => {
    test('rejects missing opentabs field', () => {
      const { opentabs: _, ...json } = validPackageJson;
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs" field is required and must be an object');
    });

    test('rejects opentabs as null', () => {
      const json = { ...validPackageJson, opentabs: null };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs" field is required and must be an object');
    });

    test('rejects opentabs as array', () => {
      const json = { ...validPackageJson, opentabs: [] };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs" field is required and must be an object');
    });

    test('rejects opentabs as string', () => {
      const json = { ...validPackageJson, opentabs: 'invalid' };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs" field is required and must be an object');
    });
  });

  describe('opentabs.displayName validation', () => {
    test('rejects missing displayName', () => {
      const { displayName: _, ...rest } = validPackageJson.opentabs;
      const json = { ...validPackageJson, opentabs: rest };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.displayName" must be a non-empty string');
    });

    test('rejects empty displayName', () => {
      const json = { ...validPackageJson, opentabs: { ...validPackageJson.opentabs, displayName: '' } };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.displayName" must be a non-empty string');
    });

    test('rejects non-string displayName', () => {
      const json = { ...validPackageJson, opentabs: { ...validPackageJson.opentabs, displayName: 42 } };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.displayName" must be a non-empty string');
    });
  });

  describe('opentabs.description validation', () => {
    test('rejects missing description', () => {
      const { description: _, ...rest } = validPackageJson.opentabs;
      const json = { ...validPackageJson, opentabs: rest };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.description" must be a non-empty string');
    });

    test('rejects empty description', () => {
      const json = { ...validPackageJson, opentabs: { ...validPackageJson.opentabs, description: '' } };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.description" must be a non-empty string');
    });

    test('rejects non-string description', () => {
      const json = { ...validPackageJson, opentabs: { ...validPackageJson.opentabs, description: false } };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.description" must be a non-empty string');
    });
  });

  describe('opentabs.urlPatterns validation', () => {
    test('rejects missing urlPatterns', () => {
      const { urlPatterns: _, ...rest } = validPackageJson.opentabs;
      const json = { ...validPackageJson, opentabs: rest };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.urlPatterns" must be a non-empty array of strings');
    });

    test('rejects empty urlPatterns array', () => {
      const json = { ...validPackageJson, opentabs: { ...validPackageJson.opentabs, urlPatterns: [] } };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.urlPatterns" must be a non-empty array of strings');
    });

    test('rejects urlPatterns as non-array', () => {
      const json = { ...validPackageJson, opentabs: { ...validPackageJson.opentabs, urlPatterns: 'not-array' } };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.urlPatterns" must be a non-empty array of strings');
    });

    test('rejects urlPatterns containing non-string values', () => {
      const json = {
        ...validPackageJson,
        opentabs: { ...validPackageJson.opentabs, urlPatterns: ['*://*.slack.com/*', 123] },
      };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.urlPatterns[1]" must be a string');
    });

    test('rejects urlPatterns with non-string at index 0', () => {
      const json = {
        ...validPackageJson,
        opentabs: { ...validPackageJson.opentabs, urlPatterns: [null] },
      };
      const error = expectErr(parsePluginPackageJson(json, sourcePath));
      expect(error).toContain('"opentabs.urlPatterns[0]" must be a string');
    });
  });

  describe('error messages include source path', () => {
    test('error message includes the provided sourcePath', () => {
      const customPath = '/home/user/plugins/my-plugin/package.json';
      const error = expectErr(parsePluginPackageJson(null, customPath));
      expect(error).toContain(customPath);
    });
  });
});

describe('isValidPluginPackageName', () => {
  test('accepts unscoped opentabs-plugin-* names', () => {
    expect(isValidPluginPackageName('opentabs-plugin-slack')).toBe(true);
    expect(isValidPluginPackageName('opentabs-plugin-my-cool-tool')).toBe(true);
  });

  test('accepts scoped opentabs-plugin-* names', () => {
    expect(isValidPluginPackageName('@opentabs-dev/opentabs-plugin-slack')).toBe(true);
    expect(isValidPluginPackageName('@my-org/opentabs-plugin-jira')).toBe(true);
    expect(isValidPluginPackageName('@company/opentabs-plugin-data-viewer')).toBe(true);
  });

  test('rejects bare opentabs-plugin- prefix with no suffix', () => {
    expect(isValidPluginPackageName('opentabs-plugin-')).toBe(false);
  });

  test('rejects scoped bare opentabs-plugin- prefix with no suffix', () => {
    expect(isValidPluginPackageName('@org/opentabs-plugin-')).toBe(false);
  });

  test('rejects names without the plugin prefix', () => {
    expect(isValidPluginPackageName('some-random-package')).toBe(false);
    expect(isValidPluginPackageName('slack')).toBe(false);
  });

  test('rejects scoped names without opentabs-plugin- in the name part', () => {
    expect(isValidPluginPackageName('@my-org/random-package')).toBe(false);
    expect(isValidPluginPackageName('@my-org/slack')).toBe(false);
  });
});
