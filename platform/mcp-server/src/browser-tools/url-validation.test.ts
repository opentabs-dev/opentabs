import { safeUrl } from './url-validation.js';
import { describe, expect, test } from 'bun:test';

describe('safeUrl', () => {
  // -- Accepted URLs --

  test('accepts https: URL', () => {
    expect(safeUrl.safeParse('https://example.com').success).toBe(true);
  });

  test('accepts http: URL', () => {
    expect(safeUrl.safeParse('http://localhost:3000/path').success).toBe(true);
  });

  test('accepts https: URL with path, query, and fragment', () => {
    expect(safeUrl.safeParse('https://example.com/a/b?q=1#frag').success).toBe(true);
  });

  // -- Rejected: disallowed schemes --

  test('rejects javascript: URL', () => {
    const result = safeUrl.safeParse('javascript:alert(1)');
    expect(result.success).toBe(false);
  });

  test('rejects data: URL', () => {
    const result = safeUrl.safeParse('data:text/html,<h1>hi</h1>');
    expect(result.success).toBe(false);
  });

  test('rejects file: URL', () => {
    const result = safeUrl.safeParse('file:///etc/passwd');
    expect(result.success).toBe(false);
  });

  test('rejects ftp: URL', () => {
    const result = safeUrl.safeParse('ftp://files.example.com/readme.txt');
    expect(result.success).toBe(false);
  });

  // -- Rejected: not a URL at all --
  // These verify the refine callback handles invalid input gracefully
  // instead of throwing (Zod 4 runs refine even when the base validator fails).

  test('rejects plain string that is not a URL', () => {
    const result = safeUrl.safeParse('not-a-url');
    expect(result.success).toBe(false);
  });

  test('rejects empty string', () => {
    const result = safeUrl.safeParse('');
    expect(result.success).toBe(false);
  });

  test('rejects non-string input', () => {
    const result = safeUrl.safeParse(12345);
    expect(result.success).toBe(false);
  });

  test('rejects null', () => {
    const result = safeUrl.safeParse(null);
    expect(result.success).toBe(false);
  });

  test('rejects undefined', () => {
    const result = safeUrl.safeParse(undefined);
    expect(result.success).toBe(false);
  });

  test('rejects URL-like string missing scheme', () => {
    const result = safeUrl.safeParse('example.com/path');
    expect(result.success).toBe(false);
  });
});
