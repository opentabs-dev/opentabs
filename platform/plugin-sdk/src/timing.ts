// ---------------------------------------------------------------------------
// Retry / timing utilities for plugin authors
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Delay between attempts in milliseconds (default: 1000) */
  delay?: number;
  /** Use exponential backoff — doubles the delay after each attempt (default: false) */
  backoff?: boolean;
  /** Maximum delay in milliseconds when using backoff, preventing unreasonable wait times (default: 30000) */
  maxDelay?: number;
  /** AbortSignal to cancel retries early */
  signal?: AbortSignal;
}

export interface WaitUntilOptions {
  /** Polling interval in milliseconds (default: 200) */
  interval?: number;
  /** Timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** AbortSignal to cancel polling early */
  signal?: AbortSignal;
}

export interface SleepOptions {
  /** AbortSignal to cancel the sleep early */
  signal?: AbortSignal;
}

/**
 * Returns a promise that resolves after `ms` milliseconds. Optionally accepts
 * an AbortSignal to cancel the sleep early.
 */
export const sleep = (ms: number, opts?: SleepOptions): Promise<void> => {
  const signal = opts?.signal;
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));

  if (signal.aborted)
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new DOMException('sleep aborted', 'AbortError'),
    );

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('sleep aborted', 'AbortError'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
};

/**
 * Retries `fn` on failure up to `maxAttempts` times. Waits `delay` ms between
 * attempts (doubled each time when `backoff` is true). Re-throws the last
 * error after all attempts are exhausted. Supports cancellation via AbortSignal.
 */
export const retry = async <T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> => {
  const maxAttempts = opts?.maxAttempts ?? 3;

  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new Error(`retry: maxAttempts must be a finite number >= 1, got ${maxAttempts}`);
  }

  const baseDelay = opts?.delay ?? 1_000;
  const backoff = opts?.backoff ?? false;
  const maxDelay = opts?.maxDelay ?? 30_000;
  const signal = opts?.signal;

  const abortReason = () => (signal?.reason instanceof Error ? signal.reason : new Error('retry: aborted'));

  const abortableSleep = (ms: number): Promise<void> => {
    if (!signal) return sleep(ms);
    if (signal.aborted) return Promise.reject(abortReason());

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(abortReason());
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw abortReason();

    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) {
      if (signal?.aborted) throw abortReason();
      const currentDelay = Math.min(backoff ? baseDelay * 2 ** (attempt - 1) : baseDelay, maxDelay);
      await abortableSleep(currentDelay);
    }
  }

  throw lastError;
};

/**
 * Polls `predicate` at `interval` ms until it returns `true`, or rejects on
 * timeout with a descriptive error. Uses recursive setTimeout to prevent
 * overlapping calls when the predicate is async.
 */
export const waitUntil = (predicate: () => boolean | Promise<boolean>, opts?: WaitUntilOptions): Promise<void> => {
  const interval = opts?.interval ?? 200;
  const timeout = opts?.timeout ?? 10_000;
  const signal = opts?.signal;

  const abortReason = () => (signal?.reason instanceof Error ? signal.reason : new Error('waitUntil: aborted'));

  if (signal?.aborted) return Promise.reject(abortReason());

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let poller: ReturnType<typeof setTimeout>;
    let lastPredicateError: unknown;

    const isSettled = () => settled;

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(poller);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (isSettled()) return;
      cleanup();
      reject(abortReason());
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      if (isSettled()) return;
      cleanup();
      const errorContext =
        lastPredicateError instanceof Error ? `: predicate last threw — ${lastPredicateError.message}` : '';
      reject(new Error(`waitUntil: timed out after ${timeout}ms waiting for predicate to return true${errorContext}`));
    }, timeout);

    const check = async () => {
      if (isSettled()) return;
      try {
        const result = await predicate();
        if (result) {
          cleanup();
          resolve();
          return;
        }
      } catch (err) {
        lastPredicateError = err;
      }
      if (!isSettled()) {
        poller = setTimeout(() => void check(), interval);
      }
    };

    // Check immediately on first call
    void check();
  });
};
