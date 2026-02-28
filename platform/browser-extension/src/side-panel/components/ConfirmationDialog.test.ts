import { resolveDisplayIndex } from './ConfirmationDialog.js';
import { describe, expect, test } from 'vitest';

describe('resolveDisplayIndex', () => {
  test('returns the same index when removal makes the next item slide into that position', () => {
    // [A, B, C] with B at index 1 displayed — remove B → [A, C], count=2
    // Index 1 still valid: shows C (not A)
    expect(resolveDisplayIndex(1, 2)).toBe(1);
  });

  test('clamps to the last item when the removed item was at the end', () => {
    // [A, B] with B at index 1 displayed — remove B → [A], count=1
    // Index 1 out of bounds: clamps to 0 → shows A
    expect(resolveDisplayIndex(1, 1)).toBe(0);
  });

  test('returns 0 when viewing the first item', () => {
    expect(resolveDisplayIndex(0, 3)).toBe(0);
  });

  test('returns count - 1 when index exceeds the new length', () => {
    expect(resolveDisplayIndex(4, 3)).toBe(2);
  });

  test('handles a single-item list', () => {
    expect(resolveDisplayIndex(0, 1)).toBe(0);
  });
});
