import { formatDuration, formatTimestamp, parseDuration, parseLimit } from './audit.js';
import { InvalidArgumentError } from 'commander';
import { afterEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// parseDuration
// ---------------------------------------------------------------------------

describe('parseDuration', () => {
  test('parses seconds', () => {
    expect(parseDuration('30s')).toBe(30_000);
  });

  test('parses minutes', () => {
    expect(parseDuration('5m')).toBe(300_000);
  });

  test('parses hours', () => {
    expect(parseDuration('2h')).toBe(7_200_000);
  });

  test('parses days', () => {
    expect(parseDuration('1d')).toBe(86_400_000);
  });

  test('returns null for alphabetic input', () => {
    expect(parseDuration('abc')).toBeNull();
  });

  test('returns null for unknown unit', () => {
    expect(parseDuration('30x')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseDuration('')).toBeNull();
  });

  test('returns null for negative values (no leading sign support)', () => {
    expect(parseDuration('-30s')).toBeNull();
  });

  test('returns null for bare number without unit', () => {
    expect(parseDuration('100')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe('formatTimestamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('same day — shows HH:MM:SS only', () => {
    // Fix "now" to 2024-06-15 12:00:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));

    const result = formatTimestamp('2024-06-15T09:30:45.000Z');
    // Should contain only the time portion (no date)
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test('different day — shows MM-DD HH:MM:SS', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));

    const result = formatTimestamp('2024-06-14T09:30:45.000Z');
    expect(result).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('midnight boundary — previous day shows date prefix', () => {
    vi.useFakeTimers();
    // "now" is just after midnight on the 15th
    vi.setSystemTime(new Date('2024-06-15T00:01:00.000Z'));

    // Timestamp from the 14th (just before midnight)
    const result = formatTimestamp('2024-06-14T23:59:00.000Z');
    expect(result).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('same day — time values are zero-padded', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-05T12:00:00.000Z'));

    const result = formatTimestamp('2024-01-05T03:04:05.000Z');
    // All three components should be two digits
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  test('sub-second shows ms', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  test('zero milliseconds shows 0ms', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  test('999ms shows ms (boundary before seconds)', () => {
    expect(formatDuration(999)).toBe('999ms');
  });

  test('exactly 1000ms shows 1.0s', () => {
    expect(formatDuration(1000)).toBe('1.0s');
  });

  test('1500ms shows 1.5s', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });

  test('10000ms shows 10.0s', () => {
    expect(formatDuration(10_000)).toBe('10.0s');
  });
});

// ---------------------------------------------------------------------------
// parseLimit
// ---------------------------------------------------------------------------

describe('parseLimit', () => {
  test('parses a valid positive integer', () => {
    expect(parseLimit('10')).toBe(10);
  });

  test('parses 1 (minimum valid value)', () => {
    expect(parseLimit('1')).toBe(1);
  });

  test('parses large numbers', () => {
    expect(parseLimit('1000')).toBe(1000);
  });

  test('throws for 0', () => {
    expect(() => parseLimit('0')).toThrow(InvalidArgumentError);
  });

  test('throws for negative integers', () => {
    expect(() => parseLimit('-5')).toThrow(InvalidArgumentError);
  });

  test('throws for non-integer floats', () => {
    expect(() => parseLimit('1.5')).toThrow(InvalidArgumentError);
  });

  test('throws for non-numeric strings', () => {
    expect(() => parseLimit('abc')).toThrow(InvalidArgumentError);
  });

  test('throws for empty string', () => {
    expect(() => parseLimit('')).toThrow(InvalidArgumentError);
  });
});
