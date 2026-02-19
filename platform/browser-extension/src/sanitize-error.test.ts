import { sanitizeErrorMessage } from './sanitize-error.js';
import { describe, expect, test } from 'bun:test';

describe('sanitizeErrorMessage', () => {
  describe('Windows absolute paths', () => {
    test('replaces backslash paths with [PATH]', () => {
      expect(sanitizeErrorMessage('Error at C:\\Users\\bob\\file.ts')).toBe('Error at [PATH]');
    });

    test('replaces forward-slash paths with [PATH]', () => {
      expect(sanitizeErrorMessage('Error at D:/Projects/app/src/index.ts')).toBe('Error at [PATH]');
    });
  });

  describe('Unix absolute paths', () => {
    test('replaces multi-segment paths with [PATH]', () => {
      expect(sanitizeErrorMessage('Error at /home/user/project/file.ts')).toBe('Error at [PATH]');
    });

    test('single segment path is NOT replaced', () => {
      expect(sanitizeErrorMessage('GET /api returned 404')).toBe('GET /api returned 404');
    });
  });

  describe('URLs', () => {
    test('strips sensitive URL content', () => {
      const result = sanitizeErrorMessage('Failed to fetch https://api.example.com/v1/data');
      expect(result).not.toContain('api.example.com');
      expect(result).not.toContain('/v1/data');
    });

    test('strips http URL content', () => {
      const result = sanitizeErrorMessage('Request to http://internal.corp/api failed');
      expect(result).not.toContain('internal.corp');
      expect(result).not.toContain('/api');
    });

    test('URL with no path is still sanitized', () => {
      const result = sanitizeErrorMessage('See https://example.com');
      expect(result).not.toContain('example.com');
    });
  });

  describe('localhost references', () => {
    test('replaces localhost:port with [LOCALHOST]', () => {
      expect(sanitizeErrorMessage('Connection refused at localhost:9515')).toBe('Connection refused at [LOCALHOST]');
    });
  });

  describe('IPv4 addresses', () => {
    test('replaces IPv4 addresses with [IP]', () => {
      expect(sanitizeErrorMessage('Cannot reach 192.168.1.1')).toBe('Cannot reach [IP]');
    });
  });

  describe('truncation', () => {
    test('truncates messages over 500 characters', () => {
      const longMessage = 'A'.repeat(600);
      const result = sanitizeErrorMessage(longMessage);
      expect(result.length).toBe(500);
      expect(result.endsWith('...')).toBe(true);
    });

    test('does not truncate messages at exactly 500 characters', () => {
      const message = 'B'.repeat(500);
      expect(sanitizeErrorMessage(message)).toBe(message);
    });
  });

  describe('passthrough', () => {
    test('clean strings pass through unchanged', () => {
      expect(sanitizeErrorMessage('Tool execution failed')).toBe('Tool execution failed');
    });

    test('empty string passes through', () => {
      expect(sanitizeErrorMessage('')).toBe('');
    });
  });

  describe('combined patterns', () => {
    test('handles message with multiple sensitive values', () => {
      const result = sanitizeErrorMessage(
        'Error at /home/user/app.ts: fetch https://api.example.com failed from 10.0.0.1',
      );
      expect(result).not.toContain('/home/user');
      expect(result).not.toContain('api.example.com');
      expect(result).not.toContain('10.0.0.1');
      expect(result).toContain('[PATH]');
      expect(result).toContain('[IP]');
    });
  });
});
