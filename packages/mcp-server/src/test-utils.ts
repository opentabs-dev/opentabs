/**
 * Test utilities for bun:test migration
 */
import type { Mock } from 'bun:test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;

/**
 * Track all mocks for clearAllMocks functionality
 */
const trackedMocks: Set<Mock<AnyFunction>> = new Set();

/**
 * Type helper to cast a function to a Mock type (equivalent to vi.mocked)
 * Usage: mocked(relay.sendServiceRequest).mockResolvedValue(...)
 */
export const mocked = <T extends AnyFunction>(fn: T): Mock<T> => fn as unknown as Mock<T>;

/**
 * Register a mock for tracking (call this when creating mocks)
 */
export const trackMock = <T extends AnyFunction>(mockFn: Mock<T>): Mock<T> => {
  trackedMocks.add(mockFn as Mock<AnyFunction>);
  return mockFn;
};

/**
 * Clear all tracked mocks (equivalent to vi.clearAllMocks)
 */
export const clearAllMocks = (): void => {
  for (const mockFn of trackedMocks) {
    mockFn.mockClear();
  }
};
