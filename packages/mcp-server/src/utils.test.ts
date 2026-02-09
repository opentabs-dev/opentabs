import { describe, it, expect } from 'bun:test';
import { success, error, formatError } from './utils.js';

describe('success', () => {
  it('should format data as JSON text content', () => {
    const result = success({ foo: 'bar' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe(JSON.stringify({ foo: 'bar' }, null, 2));
    expect(result.isError).toBeUndefined();
  });

  it('should handle arrays', () => {
    const result = success([1, 2, 3]);

    expect(result.content[0].text).toBe(JSON.stringify([1, 2, 3], null, 2));
  });

  it('should handle null and undefined', () => {
    expect(success(null).content[0].text).toBe('null');
    expect(success(undefined).content[0].text).toBeUndefined;
  });
});

describe('error', () => {
  it('should format error with isError flag', () => {
    const result = error(new Error('test error'));

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Error:');
    expect(result.isError).toBe(true);
  });

  it('should handle string errors', () => {
    const result = error('string error');

    expect(result.content[0].text).toBe('Error: string error');
    expect(result.isError).toBe(true);
  });
});

describe('formatError', () => {
  it('should provide user-friendly message for connection errors', () => {
    const message = formatError(new Error('WebSocket not connected'));

    expect(message).toContain('Chrome extension not connected');
    expect(message).toContain('OpenTabs extension');
  });

  it('should provide user-friendly message for timeout errors', () => {
    const message = formatError(new Error('Request timed out'));

    expect(message).toContain('timed out');
    expect(message).toContain('API');
  });

  it('should provide user-friendly message for channel not found', () => {
    const message = formatError(new Error('channel_not_found'));

    expect(message).toContain('Channel not found');
  });

  it('should provide user-friendly message for auth errors', () => {
    const invalidAuth = formatError(new Error('invalid_auth'));
    expect(invalidAuth).toContain('Authentication failed');

    const notAuthed = formatError(new Error('not_authed'));
    expect(notAuthed).toContain('Authentication failed');
  });

  it('should provide user-friendly message for rate limiting', () => {
    const message = formatError(new Error('ratelimited'));

    expect(message).toContain('Rate limited');
  });

  it('should provide user-friendly message for user not found', () => {
    const message = formatError(new Error('user_not_found'));

    expect(message).toContain('User not found');
    expect(message).toContain('user ID');
  });

  it('should provide user-friendly message for connection closed', () => {
    const message = formatError(new Error('Connection closed'));

    expect(message).toContain('Connection to extension was lost');
  });

  it('should return original message for unknown errors', () => {
    const message = formatError(new Error('some unknown error'));

    expect(message).toBe('some unknown error');
  });

  it('should handle non-Error objects', () => {
    expect(formatError('string')).toBe('string');
    expect(formatError(123)).toBe('123');
    expect(formatError({ foo: 'bar' })).toBe('[object Object]');
  });
});
