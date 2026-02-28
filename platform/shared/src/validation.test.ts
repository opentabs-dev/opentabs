import { EXTENSION_COPY_EXCLUDE_PATTERN, isBlockedUrlScheme, validatePluginName, validateUrlPattern } from './index.js';
import { describe, expect, test } from 'vitest';

describe('validateUrlPattern', () => {
  describe('valid patterns', () => {
    test('https with specific domain', () => {
      expect(validateUrlPattern('https://example.com/*')).toBeNull();
    });

    test('http with specific domain', () => {
      expect(validateUrlPattern('http://example.com/*')).toBeNull();
    });

    test('wildcard scheme with specific domain', () => {
      expect(validateUrlPattern('*://example.com/*')).toBeNull();
    });

    test('subdomain wildcard', () => {
      expect(validateUrlPattern('*://*.slack.com/*')).toBeNull();
    });

    test('localhost', () => {
      expect(validateUrlPattern('*://localhost/*')).toBeNull();
    });

    test('localhost with port', () => {
      expect(validateUrlPattern('*://localhost:3000/*')).toBeNull();
    });

    test('IPv4 address', () => {
      expect(validateUrlPattern('*://192.168.1.1/*')).toBeNull();
    });

    test('IPv4 address with port', () => {
      expect(validateUrlPattern('https://10.0.0.1:8080/*')).toBeNull();
    });

    test('IPv4 loopback', () => {
      expect(validateUrlPattern('*://127.0.0.1/*')).toBeNull();
    });

    test('specific path', () => {
      expect(validateUrlPattern('https://example.com/api/*')).toBeNull();
    });

    test('wildcard host', () => {
      expect(validateUrlPattern('*://*/*')).not.toBeNull(); // Too broad — should be rejected
    });
  });

  describe('overly broad patterns', () => {
    test('rejects *://*/*', () => {
      const error = validateUrlPattern('*://*/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('rejects <all_urls>', () => {
      const error = validateUrlPattern('<all_urls>');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });
  });

  describe('bare TLD wildcard patterns', () => {
    test('rejects *.com', () => {
      const error = validateUrlPattern('*://*.com/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
      expect(error).toContain('*.com');
      expect(error).toContain('*.example.com');
    });

    test('rejects *.org', () => {
      const error = validateUrlPattern('*://*.org/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('rejects *.net', () => {
      const error = validateUrlPattern('*://*.net/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('rejects *.io', () => {
      const error = validateUrlPattern('*://*.io/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('rejects *.dev', () => {
      const error = validateUrlPattern('*://*.dev/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('rejects *.app', () => {
      const error = validateUrlPattern('*://*.app/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('rejects *.edu', () => {
      const error = validateUrlPattern('*://*.edu/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('rejects *.gov', () => {
      const error = validateUrlPattern('*://*.gov/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('rejects *.xyz', () => {
      const error = validateUrlPattern('https://*.xyz/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too broad');
    });

    test('allows *.example.com (second-level domain)', () => {
      expect(validateUrlPattern('*://*.example.com/*')).toBeNull();
    });

    test('allows *://app.slack.com/* (specific subdomain)', () => {
      expect(validateUrlPattern('*://app.slack.com/*')).toBeNull();
    });

    test('allows *://localhost:3000/*', () => {
      expect(validateUrlPattern('*://localhost:3000/*')).toBeNull();
    });
  });

  describe('path wildcard limit', () => {
    test('accepts pattern with 3 wildcards in path', () => {
      expect(validateUrlPattern('*://example.com/a/*/b/*/c/*')).toBeNull();
    });

    test('accepts pattern with 5 wildcards in path', () => {
      expect(validateUrlPattern('*://example.com/a/*/b/*/c/*/d/*/e/*')).toBeNull();
    });

    test('rejects pattern with 7 wildcards in path', () => {
      const error = validateUrlPattern('*://example.com/*/*/*/*/*/*/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too many wildcards in path (max 5)');
    });

    test('rejects pattern with 6 wildcards in path', () => {
      const error = validateUrlPattern('*://example.com/a/*/b/*/c/*/d/*/e/*/f/*');
      expect(error).not.toBeNull();
      expect(error).toContain('too many wildcards in path (max 5)');
    });
  });

  describe('invalid patterns', () => {
    test('rejects missing scheme', () => {
      const error = validateUrlPattern('example.com/*');
      expect(error).not.toBeNull();
      expect(error).toContain('not a valid Chrome match pattern');
    });

    test('rejects empty string', () => {
      const error = validateUrlPattern('');
      expect(error).not.toBeNull();
    });

    test('rejects invalid host format', () => {
      const error = validateUrlPattern('*://???/*');
      expect(error).not.toBeNull();
      expect(error).toContain('invalid host');
    });
  });

  describe('host validation', () => {
    test('accepts standard TLD domains', () => {
      expect(validateUrlPattern('*://app.example.com/*')).toBeNull();
    });

    test('accepts subdomain wildcard with TLD', () => {
      expect(validateUrlPattern('*://*.example.co.uk/*')).toBeNull();
    });

    test('accepts wildcard host *', () => {
      // When host is just *, it's caught by the overly-broad check
      // since the full pattern becomes *://*/* which is <all_urls>-equivalent
      // But *://*/specific-path is valid:
      expect(validateUrlPattern('https://*/api')).toBeNull();
    });
  });

  describe('ftp scheme', () => {
    test('rejects ftp scheme (Chrome removed FTP support)', () => {
      const error = validateUrlPattern('ftp://example.com/*');
      expect(error).not.toBeNull();
      expect(error).toContain('not a valid Chrome match pattern');
    });
  });

  describe('ReDoS protection', () => {
    test('completes in bounded time for pathological input (ReDoS protection)', () => {
      const start = Date.now();
      const result = validateUrlPattern('*://' + 'a'.repeat(50) + '!/path');
      const elapsed = Date.now() - start;
      expect(result).not.toBeNull(); // invalid host — returns error string
      expect(elapsed).toBeLessThan(100); // must complete in under 100ms
    });
  });
});

describe('validatePluginName', () => {
  describe('valid names', () => {
    test('simple lowercase name', () => {
      expect(validatePluginName('slack')).toBeNull();
    });

    test('name with hyphens', () => {
      expect(validatePluginName('my-plugin')).toBeNull();
    });

    test('name with multiple hyphens', () => {
      expect(validatePluginName('my-cool-plugin')).toBeNull();
    });

    test('name with digits', () => {
      expect(validatePluginName('plugin123')).toBeNull();
    });

    test('name mixing letters and digits with hyphens', () => {
      expect(validatePluginName('my-plugin-2')).toBeNull();
    });

    test('single character name', () => {
      expect(validatePluginName('a')).toBeNull();
    });

    test('single digit name', () => {
      expect(validatePluginName('1')).toBeNull();
    });
  });

  describe('invalid names', () => {
    test('empty string', () => {
      expect(validatePluginName('')).toBe('Plugin name is required');
    });

    test('uppercase characters', () => {
      const error = validatePluginName('MyPlugin');
      expect(error).not.toBeNull();
      expect(error).toContain('lowercase alphanumeric');
    });

    test('leading hyphen', () => {
      const error = validatePluginName('-plugin');
      expect(error).not.toBeNull();
      expect(error).toContain('lowercase alphanumeric');
    });

    test('trailing hyphen', () => {
      const error = validatePluginName('plugin-');
      expect(error).not.toBeNull();
      expect(error).toContain('lowercase alphanumeric');
    });

    test('consecutive hyphens', () => {
      const error = validatePluginName('my--plugin');
      expect(error).not.toBeNull();
      expect(error).toContain('lowercase alphanumeric');
    });

    test('underscores', () => {
      const error = validatePluginName('my_plugin');
      expect(error).not.toBeNull();
      expect(error).toContain('lowercase alphanumeric');
    });

    test('spaces', () => {
      const error = validatePluginName('my plugin');
      expect(error).not.toBeNull();
      expect(error).toContain('lowercase alphanumeric');
    });

    test('dots', () => {
      const error = validatePluginName('my.plugin');
      expect(error).not.toBeNull();
      expect(error).toContain('lowercase alphanumeric');
    });

    test('special characters', () => {
      const error = validatePluginName('plugin@1');
      expect(error).not.toBeNull();
      expect(error).toContain('lowercase alphanumeric');
    });
  });

  describe('reserved names', () => {
    test('system is reserved', () => {
      const error = validatePluginName('system');
      expect(error).not.toBeNull();
      expect(error).toContain('reserved');
    });

    test('browser is reserved', () => {
      const error = validatePluginName('browser');
      expect(error).not.toBeNull();
      expect(error).toContain('reserved');
    });

    test('opentabs is reserved', () => {
      const error = validatePluginName('opentabs');
      expect(error).not.toBeNull();
      expect(error).toContain('reserved');
    });

    test('extension is reserved', () => {
      const error = validatePluginName('extension');
      expect(error).not.toBeNull();
      expect(error).toContain('reserved');
    });

    test('config is reserved', () => {
      const error = validatePluginName('config');
      expect(error).not.toBeNull();
      expect(error).toContain('reserved');
    });

    test('plugin is reserved', () => {
      const error = validatePluginName('plugin');
      expect(error).not.toBeNull();
      expect(error).toContain('reserved');
    });

    test('tool is reserved', () => {
      const error = validatePluginName('tool');
      expect(error).not.toBeNull();
      expect(error).toContain('reserved');
    });

    test('mcp is reserved', () => {
      const error = validatePluginName('mcp');
      expect(error).not.toBeNull();
      expect(error).toContain('reserved');
    });
  });
});

describe('isBlockedUrlScheme', () => {
  describe('blocked schemes', () => {
    test('blocks javascript: URLs', () => {
      expect(isBlockedUrlScheme('javascript:alert(1)')).toBe(true);
    });

    test('blocks data: URLs', () => {
      expect(isBlockedUrlScheme('data:text/html,<h1>hi</h1>')).toBe(true);
    });

    test('blocks file: URLs', () => {
      expect(isBlockedUrlScheme('file:///etc/passwd')).toBe(true);
    });

    test('blocks chrome: URLs', () => {
      expect(isBlockedUrlScheme('chrome://extensions/')).toBe(true);
    });

    test('blocks blob: URLs', () => {
      expect(isBlockedUrlScheme('blob:https://example.com/uuid')).toBe(true);
    });
  });

  describe('allowed schemes', () => {
    test('allows http: URLs', () => {
      expect(isBlockedUrlScheme('http://example.com')).toBe(false);
    });

    test('allows https: URLs', () => {
      expect(isBlockedUrlScheme('https://example.com')).toBe(false);
    });

    test('allows https with path and query', () => {
      expect(isBlockedUrlScheme('https://example.com/path?q=1')).toBe(false);
    });
  });

  describe('case sensitivity', () => {
    test('uppercase JAVASCRIPT: is blocked (URL parser lowercases scheme)', () => {
      expect(isBlockedUrlScheme('JAVASCRIPT:alert(1)')).toBe(true);
    });

    test('mixed case Chrome: is blocked', () => {
      expect(isBlockedUrlScheme('Chrome://settings/')).toBe(true);
    });

    test('uppercase HTTPS: is allowed', () => {
      expect(isBlockedUrlScheme('HTTPS://example.com')).toBe(false);
    });
  });

  describe('unparseable URLs', () => {
    test('empty string is blocked', () => {
      expect(isBlockedUrlScheme('')).toBe(true);
    });

    test('bare word is blocked', () => {
      expect(isBlockedUrlScheme('notaurl')).toBe(true);
    });

    test('missing scheme is blocked', () => {
      expect(isBlockedUrlScheme('://example.com')).toBe(true);
    });
  });
});

describe('EXTENSION_COPY_EXCLUDE_PATTERN', () => {
  const pattern = EXTENSION_COPY_EXCLUDE_PATTERN;

  describe('directory-segment exclusions (node_modules, src, .git)', () => {
    test('matches node_modules at root', () => {
      expect(pattern.test('node_modules')).toBe(true);
    });

    test('matches node_modules/foo', () => {
      expect(pattern.test('node_modules/foo')).toBe(true);
    });

    test('matches src at root', () => {
      expect(pattern.test('src')).toBe(true);
    });

    test('matches src/background.ts', () => {
      expect(pattern.test('src/background.ts')).toBe(true);
    });

    test('matches .git at root', () => {
      expect(pattern.test('.git')).toBe(true);
    });

    test('matches .git/objects', () => {
      expect(pattern.test('.git/objects')).toBe(true);
    });
  });

  describe('storybook exclusions', () => {
    test('matches .storybook at root', () => {
      expect(pattern.test('.storybook')).toBe(true);
    });

    test('matches .storybook/main.ts', () => {
      expect(pattern.test('.storybook/main.ts')).toBe(true);
    });

    test('matches storybook-static at root', () => {
      expect(pattern.test('storybook-static')).toBe(true);
    });

    test('matches storybook-static/index.json', () => {
      expect(pattern.test('storybook-static/index.json')).toBe(true);
    });
  });

  describe('tsconfig exclusions', () => {
    test('matches tsconfig.json at root', () => {
      expect(pattern.test('tsconfig.json')).toBe(true);
    });

    test('matches tsconfig.test.json at root', () => {
      expect(pattern.test('tsconfig.test.json')).toBe(true);
    });

    test('matches tsconfig.json in subdirectory', () => {
      expect(pattern.test('sub/tsconfig.json')).toBe(true);
    });

    test('matches tsconfig.base.json in subdirectory', () => {
      expect(pattern.test('sub/tsconfig.base.json')).toBe(true);
    });

    test('matches tsconfig.test.json in subdirectory', () => {
      expect(pattern.test('sub/tsconfig.test.json')).toBe(true);
    });
  });

  describe('build script and metadata exclusions', () => {
    test('matches build-extension.ts', () => {
      expect(pattern.test('build-extension.ts')).toBe(true);
    });

    test('matches build-side-panel.ts', () => {
      expect(pattern.test('build-side-panel.ts')).toBe(true);
    });

    test('matches package.json at root', () => {
      expect(pattern.test('package.json')).toBe(true);
    });

    test('matches CLAUDE.md at root', () => {
      expect(pattern.test('CLAUDE.md')).toBe(true);
    });
  });

  describe('paths that should NOT be excluded', () => {
    test('does not match dist', () => {
      expect(pattern.test('dist')).toBe(false);
    });

    test('does not match dist/background.js', () => {
      expect(pattern.test('dist/background.js')).toBe(false);
    });

    test('does not match manifest.json', () => {
      expect(pattern.test('manifest.json')).toBe(false);
    });

    test('does not match icons', () => {
      expect(pattern.test('icons')).toBe(false);
    });

    test('does not match icons/icon-128.png', () => {
      expect(pattern.test('icons/icon-128.png')).toBe(false);
    });

    test('does not match side-panel', () => {
      expect(pattern.test('side-panel')).toBe(false);
    });

    test('does not match side-panel/index.html', () => {
      expect(pattern.test('side-panel/index.html')).toBe(false);
    });

    test('does not match offscreen', () => {
      expect(pattern.test('offscreen')).toBe(false);
    });

    test('does not match offscreen/offscreen.html', () => {
      expect(pattern.test('offscreen/offscreen.html')).toBe(false);
    });
  });
});
