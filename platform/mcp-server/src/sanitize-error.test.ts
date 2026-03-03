import { sanitizeErrorMessage } from './sanitize-error.js';
import { describe, expect, test } from 'vitest';

describe('sanitizeErrorMessage', () => {
  describe('passthrough', () => {
    test('returns a simple message unchanged', () => {
      expect(sanitizeErrorMessage('Something went wrong')).toBe('Something went wrong');
    });

    test('returns an empty string unchanged', () => {
      expect(sanitizeErrorMessage('')).toBe('');
    });
  });

  describe('unix path sanitization', () => {
    test('replaces unix absolute paths with [PATH]', () => {
      expect(sanitizeErrorMessage('Failed to read /home/user/secrets/config.json')).toBe('Failed to read [PATH]');
    });

    test('replaces deeply nested unix paths', () => {
      expect(sanitizeErrorMessage('Error at /usr/local/lib/node_modules/pkg/index.js:42')).toBe('Error at [PATH]:42');
    });

    test('does not replace single-segment unix paths like /tmp', () => {
      expect(sanitizeErrorMessage('File not found in /tmp')).toBe('File not found in /tmp');
    });

    test('does not replace single-segment unix paths like /etc', () => {
      expect(sanitizeErrorMessage('/etc permission denied')).toBe('/etc permission denied');
    });

    test('does not replace single-segment unix paths like /var', () => {
      expect(sanitizeErrorMessage('Could not access /var')).toBe('Could not access /var');
    });

    test('does not replace single-segment URL path fragments like /api', () => {
      expect(sanitizeErrorMessage('Route /api not found')).toBe('Route /api not found');
    });

    test('does not replace single-segment URL path fragments like /json', () => {
      expect(sanitizeErrorMessage('Cannot parse /json response')).toBe('Cannot parse /json response');
    });

    test('replaces multi-segment URL path fragments like /api/v1/users with [PATH]', () => {
      expect(sanitizeErrorMessage('Request to /api/v1/users failed')).toBe('Request to [PATH] failed');
    });

    test('does not replace a single slash', () => {
      expect(sanitizeErrorMessage('status is 1/2 complete')).toBe('status is 1/2 complete');
    });
  });

  describe('windows path sanitization', () => {
    test('replaces windows backslash paths with [PATH]', () => {
      expect(sanitizeErrorMessage('Cannot find C:\\Users\\admin\\project\\file.ts')).toBe('Cannot find [PATH]');
    });

    test('replaces windows forward-slash paths with [PATH]', () => {
      expect(sanitizeErrorMessage('Cannot find C:/Users/admin/project/file.ts')).toBe('Cannot find [PATH]');
    });
  });

  describe('URL sanitization', () => {
    test('replaces full https URL with [URL]', () => {
      expect(sanitizeErrorMessage('Request to https://api.example.com/v1/users failed')).toBe(
        'Request to [URL] failed',
      );
    });

    test('replaces full http URL with [URL]', () => {
      expect(sanitizeErrorMessage('Fetched http://internal-service.corp/data')).toBe('Fetched [URL]');
    });

    test('replaces URL so protocol prefix does not leak as https:[PATH]', () => {
      expect(sanitizeErrorMessage('Failed to connect to https://internal.corp/api/v2')).toBe(
        'Failed to connect to [URL]',
      );
    });
  });

  describe('localhost sanitization', () => {
    test('replaces localhost:port with [LOCALHOST]', () => {
      expect(sanitizeErrorMessage('Connect to localhost:3000 refused')).toBe('Connect to [LOCALHOST] refused');
    });

    test('replaces localhost with high port', () => {
      expect(sanitizeErrorMessage('Error at localhost:54321')).toBe('Error at [LOCALHOST]');
    });

    test('replaces bare localhost without port', () => {
      expect(sanitizeErrorMessage('connection refused to localhost')).toBe('connection refused to [LOCALHOST]');
    });
  });

  describe('IPv4 sanitization', () => {
    test('replaces IPv4 addresses with [IP]', () => {
      expect(sanitizeErrorMessage('Connection to 192.168.1.100 timed out')).toBe('Connection to [IP] timed out');
    });

    test('replaces loopback address', () => {
      expect(sanitizeErrorMessage('Listening on 127.0.0.1')).toBe('Listening on [IP]');
    });
  });

  describe('IPv6 sanitization', () => {
    test('replaces bracket-wrapped loopback [::1]', () => {
      expect(sanitizeErrorMessage('Connection refused [::1]:3000')).toBe('Connection refused [IP]:3000');
    });

    test('replaces bracket-wrapped link-local [fe80::1]', () => {
      expect(sanitizeErrorMessage('Failed to connect to [fe80::1]')).toBe('Failed to connect to [IP]');
    });

    test('replaces bracket-wrapped general IPv6 [2001:db8::1]', () => {
      expect(sanitizeErrorMessage('Address [2001:db8::1] unreachable')).toBe('Address [IP] unreachable');
    });

    test('replaces unbracketed loopback ::1', () => {
      expect(sanitizeErrorMessage('ECONNREFUSED ::1')).toBe('ECONNREFUSED [IP]');
    });

    test('replaces link-local fe80::1', () => {
      expect(sanitizeErrorMessage('connect ECONNREFUSED fe80::1')).toBe('connect ECONNREFUSED [IP]');
    });

    test('replaces compressed IPv6 2001:db8::1', () => {
      expect(sanitizeErrorMessage('Host 2001:db8::1 not found')).toBe('Host [IP] not found');
    });

    test('replaces mixed IPv6/IPv4 ::ffff:192.168.1.1 in full', () => {
      expect(sanitizeErrorMessage('Mapped address ::ffff:192.168.1.1')).toBe('Mapped address [IP]');
    });

    test('does not replace array indices like [0]', () => {
      expect(sanitizeErrorMessage("Cannot read property '[0]' of undefined")).toBe(
        "Cannot read property '[0]' of undefined",
      );
    });

    test('does not replace unbracketed text without ::', () => {
      expect(sanitizeErrorMessage('version: 1.2.3')).toBe('version: 1.2.3');
    });
  });

  describe('multiple replacements', () => {
    test('sanitizes multiple sensitive patterns in one message', () => {
      const input = 'Error at /home/user/app.js connecting to localhost:8080 via 10.0.0.1';
      const result = sanitizeErrorMessage(input);
      expect(result).not.toContain('/home/user');
      expect(result).not.toContain('localhost:8080');
      expect(result).not.toContain('10.0.0.1');
      expect(result).toContain('[PATH]');
      expect(result).toContain('[LOCALHOST]');
      expect(result).toContain('[IP]');
    });
  });

  describe('truncation', () => {
    test('truncates messages exceeding 500 characters', () => {
      const longMessage = 'A'.repeat(600);
      const result = sanitizeErrorMessage(longMessage);
      expect(result.length).toBe(500);
      expect(result.endsWith('...')).toBe(true);
    });

    test('does not truncate messages at exactly 500 characters', () => {
      const message = 'B'.repeat(500);
      const result = sanitizeErrorMessage(message);
      expect(result).toBe(message);
      expect(result.length).toBe(500);
    });

    test('does not truncate messages under 500 characters', () => {
      const message = 'C'.repeat(499);
      expect(sanitizeErrorMessage(message)).toBe(message);
    });
  });

  describe('string errors', () => {
    test('sanitizes a raw string containing a path', () => {
      expect(sanitizeErrorMessage('/etc/passwd not found')).toBe('[PATH] not found');
    });
  });
});
