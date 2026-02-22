import { sanitizeErrorMessage } from './sanitize-error.js';
import { describe, expect, test } from 'bun:test';

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
    test('strips URL content — path regex matches the path portion first', () => {
      const result = sanitizeErrorMessage('Request to https://api.example.com/v1/users failed');
      expect(result).not.toContain('api.example.com');
      expect(result).not.toContain('/v1/users');
    });

    test('strips http URLs — path regex matches the path portion first', () => {
      const result = sanitizeErrorMessage('Fetched http://internal-service.corp/data');
      expect(result).not.toContain('internal-service');
      expect(result).not.toContain('/data');
    });
  });

  describe('localhost sanitization', () => {
    test('replaces localhost:port with [LOCALHOST]', () => {
      expect(sanitizeErrorMessage('Connect to localhost:3000 refused')).toBe('Connect to [LOCALHOST] refused');
    });

    test('replaces localhost with high port', () => {
      expect(sanitizeErrorMessage('Error at localhost:54321')).toBe('Error at [LOCALHOST]');
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
