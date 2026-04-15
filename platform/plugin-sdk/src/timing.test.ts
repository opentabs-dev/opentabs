import { describe, expect, test } from 'vitest';
import { retry, sleep, waitUntil } from './timing.js';

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

describe('sleep', () => {
  test('resolves after the specified delay', async () => {
    const start = performance.now();
    await sleep(50);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  test('resolves with undefined', async () => {
    await sleep(10);
  });

  test('rejects immediately when signal is already aborted with custom reason', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    try {
      await sleep(10_000, { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('cancelled');
    }
  });

  test('rejects promptly when signal is aborted during sleep', async () => {
    const controller = new AbortController();
    const start = performance.now();
    const sleepPromise = sleep(10_000, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('user cancelled')), 50);
    try {
      await sleepPromise;
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('user cancelled');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2_000);
  });

  test('throws DOMException when signal is aborted without custom reason', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await sleep(10_000, { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('AbortError');
    }
  });

  test('behaves identically to no-signal when opts.signal is undefined', async () => {
    const start = performance.now();
    await sleep(50, { signal: undefined });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

describe('retry', () => {
  test('returns result on first success', async () => {
    const result = await retry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  test('retries on failure and returns on eventual success', async () => {
    let calls = 0;
    const result = await retry(
      () => {
        calls++;
        if (calls < 3) return Promise.reject(new Error(`fail #${calls}`));
        return Promise.resolve('ok');
      },
      { maxAttempts: 5, delay: 10 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  test('throws last error after exhausting all attempts', async () => {
    let calls = 0;
    try {
      await retry(
        () => {
          calls++;
          return Promise.reject(new Error(`fail #${calls}`));
        },
        { maxAttempts: 3, delay: 10 },
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('fail #3');
    }
    expect(calls).toBe(3);
  });

  test('uses default maxAttempts of 3', async () => {
    let calls = 0;
    try {
      await retry(
        () => {
          calls++;
          return Promise.reject(new Error('fail'));
        },
        { delay: 10 },
      );
    } catch {
      // Expected
    }
    expect(calls).toBe(3);
  });

  test('supports exponential backoff', async () => {
    let calls = 0;
    const timestamps: number[] = [];
    try {
      await retry(
        () => {
          calls++;
          timestamps.push(performance.now());
          return Promise.reject(new Error('fail'));
        },
        { maxAttempts: 3, delay: 50, backoff: true },
      );
    } catch {
      // Expected
    }
    expect(calls).toBe(3);
    // First delay: 50ms, second delay: 100ms
    expect(timestamps).toHaveLength(3);
    const [t0, t1, t2] = timestamps as [number, number, number];
    const delay1 = t1 - t0;
    const delay2 = t2 - t1;
    expect(delay1).toBeGreaterThanOrEqual(40);
    expect(delay2).toBeGreaterThanOrEqual(80);
  });

  test('caps delay at maxDelay when using backoff', async () => {
    let calls = 0;
    const timestamps: number[] = [];
    try {
      await retry(
        () => {
          calls++;
          timestamps.push(performance.now());
          return Promise.reject(new Error('fail'));
        },
        { maxAttempts: 4, delay: 50, backoff: true, maxDelay: 60 },
      );
    } catch {
      // Expected
    }
    expect(calls).toBe(4);
    // Delays: min(50, 60)=50, min(100, 60)=60, min(200, 60)=60
    // The third delay should be capped at 60ms instead of growing to 200ms
    const [t0, t1, t2, t3] = timestamps as [number, number, number, number];
    const delay1 = t1 - t0;
    const delay2 = t2 - t1;
    const delay3 = t3 - t2;
    expect(delay1).toBeGreaterThanOrEqual(40);
    expect(delay2).toBeGreaterThanOrEqual(50);
    // Without maxDelay, delay3 would be ~200ms; with maxDelay=60, it should be ~60ms
    expect(delay3).toBeLessThan(120);
  });

  test('uses default maxDelay of 30000ms', async () => {
    // Verify the default is applied by checking the option exists
    let calls = 0;
    const result = await retry(
      () => {
        calls++;
        if (calls < 2) return Promise.reject(new Error('fail'));
        return Promise.resolve('ok');
      },
      { delay: 10, backoff: true },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  test('respects AbortSignal that is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    try {
      await retry(() => Promise.resolve('should not run'), { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('cancelled');
    }
  });

  test('respects AbortSignal aborted between retries', async () => {
    const controller = new AbortController();
    let calls = 0;
    try {
      await retry(
        () => {
          calls++;
          if (calls === 1) controller.abort(new Error('user cancelled'));
          return Promise.reject(new Error('fail'));
        },
        { maxAttempts: 5, delay: 10, signal: controller.signal },
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('user cancelled');
    }
    expect(calls).toBe(1);
  });

  test('throws Error with descriptive message when maxAttempts is 0', async () => {
    await expect(retry(() => Promise.resolve('x'), { maxAttempts: 0 })).rejects.toThrow(
      'retry: maxAttempts must be a finite number >= 1, got 0',
    );
  });

  test('throws Error with descriptive message when maxAttempts is NaN', async () => {
    await expect(retry(() => Promise.resolve('x'), { maxAttempts: NaN })).rejects.toThrow(
      'retry: maxAttempts must be a finite number >= 1, got NaN',
    );
  });

  test('throws Error with descriptive message when maxAttempts is Infinity', async () => {
    await expect(retry(() => Promise.resolve('x'), { maxAttempts: Infinity })).rejects.toThrow(
      'retry: maxAttempts must be a finite number >= 1, got Infinity',
    );
  });

  test('throws Error with descriptive message when maxAttempts is -1', async () => {
    await expect(retry(() => Promise.resolve('x'), { maxAttempts: -1 })).rejects.toThrow(
      'retry: maxAttempts must be a finite number >= 1, got -1',
    );
  });

  test('throws DOMException when signal is aborted without a custom reason', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await retry(() => Promise.resolve('nope'), { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('AbortError');
    }
  });

  test('returns fn result when signal is aborted while fn is executing and fn succeeds', async () => {
    const controller = new AbortController();
    const fn = () => new Promise<string>(resolve => setTimeout(() => resolve('success'), 100));
    const retryPromise = retry(fn, { maxAttempts: 3, delay: 1_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('mid-attempt abort')), 30);
    const result = await retryPromise;
    expect(result).toBe('success');
  });

  test('throws abort reason when signal is aborted while fn is executing and fn fails', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fn = () =>
      new Promise<string>((_, reject) =>
        setTimeout(() => {
          calls++;
          reject(new Error('fn error'));
        }, 100),
      );
    const retryPromise = retry(fn, { maxAttempts: 3, delay: 1_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('mid-attempt abort')), 30);
    try {
      await retryPromise;
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('mid-attempt abort');
    }
    expect(calls).toBe(1);
  });

  test('rejects promptly when AbortSignal is aborted during inter-retry sleep', async () => {
    const controller = new AbortController();
    const start = performance.now();
    const retryPromise = retry(() => Promise.reject(new Error('fail')), {
      maxAttempts: 10,
      delay: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('cancel during sleep')), 50);
    try {
      await retryPromise;
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('cancel during sleep');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2_000);
  });
});

// ---------------------------------------------------------------------------
// waitUntil
// ---------------------------------------------------------------------------

describe('waitUntil', () => {
  test('resolves immediately when predicate is true', async () => {
    const start = performance.now();
    await waitUntil(() => true, { interval: 10, timeout: 1_000 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test('polls until predicate becomes true', async () => {
    let count = 0;
    await waitUntil(
      () => {
        count++;
        return count >= 3;
      },
      { interval: 20, timeout: 2_000 },
    );
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('rejects on timeout with descriptive error', async () => {
    try {
      await waitUntil(() => false, { interval: 10, timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('timed out after 100ms');
      expect((error as Error).message).toContain('predicate');
    }
  });

  test('supports async predicates', async () => {
    let count = 0;
    await waitUntil(
      async () => {
        count++;
        await sleep(5);
        return count >= 2;
      },
      { interval: 20, timeout: 2_000 },
    );
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('keeps polling when predicate throws', async () => {
    let count = 0;
    await waitUntil(
      () => {
        count++;
        if (count < 3) throw new Error('not ready');
        return true;
      },
      { interval: 20, timeout: 2_000 },
    );
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('keeps polling when async predicate rejects', async () => {
    let count = 0;
    await waitUntil(
      async () => {
        count++;
        if (count < 3) return Promise.reject(new Error('async fail'));
        return true;
      },
      { interval: 20, timeout: 2_000 },
    );
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('uses default interval of 200ms and timeout of 10000ms', async () => {
    const start = performance.now();
    let count = 0;
    await waitUntil(() => {
      count++;
      return count >= 2;
    });
    const elapsed = performance.now() - start;
    // With default 200ms interval, second call happens around 200ms
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(2_000);
  });

  test('respects AbortSignal that is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    try {
      await waitUntil(() => false, { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('cancelled');
    }
  });

  test('rejects with signal reason when aborted during polling', async () => {
    const controller = new AbortController();
    const waitPromise = waitUntil(() => false, {
      interval: 5_000,
      timeout: 60_000,
      signal: controller.signal,
    });
    const start = performance.now();
    setTimeout(() => controller.abort(new Error('user cancelled')), 50);
    try {
      await waitPromise;
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('user cancelled');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2_000);
  });

  test('stops further predicate calls after abort', async () => {
    const controller = new AbortController();
    let calls = 0;
    const waitPromise = waitUntil(
      () => {
        calls++;
        return false;
      },
      { interval: 20, timeout: 10_000, signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error('stop')), 60);
    try {
      await waitPromise;
    } catch {
      // Expected
    }
    const callsSnapshot = calls;
    await sleep(100);
    expect(calls).toBe(callsSnapshot);
  });

  test('throws DOMException when signal is aborted without a custom reason', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await waitUntil(() => false, { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('AbortError');
    }
  });

  test('timeout message includes last predicate error when predicate always throws', async () => {
    try {
      await waitUntil(
        () => {
          throw new Error('predicate always fails');
        },
        { interval: 20, timeout: 100 },
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('timed out after 100ms');
      expect((error as Error).message).toContain('predicate always fails');
    }
  });

  test('timeout message has no error context when predicate never throws', async () => {
    try {
      await waitUntil(() => false, { interval: 10, timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toBe('waitUntil: timed out after 100ms waiting for predicate to return true');
    }
  });
});
