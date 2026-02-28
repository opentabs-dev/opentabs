import { followFile } from './logs.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { statSync, createReadStream, watch } from 'node:fs';
import type * as Fs from 'node:fs';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    statSync: vi.fn(),
    createReadStream: vi.fn(),
    watch: vi.fn(),
  };
});

const mockStatSync = vi.mocked(statSync);
const mockCreateReadStream = vi.mocked(createReadStream);
const mockWatch = vi.mocked(watch);

describe('followFile', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test('reads new content immediately after watcher setup to close content gap', async () => {
    const mockStream = new EventEmitter();
    mockStatSync.mockReturnValue({ size: 100 } as ReturnType<typeof statSync>);
    mockCreateReadStream.mockReturnValue(mockStream as unknown as ReturnType<typeof createReadStream>);
    mockWatch.mockReturnValue({ close: vi.fn() } as unknown as ReturnType<typeof watch>);

    // Don't await — followFile never resolves
    void followFile('/tmp/test.log', 0);

    // Yield to allow synchronous code to run
    await Promise.resolve();

    // createReadStream should have been called even without any file system events
    expect(mockCreateReadStream).toHaveBeenCalledTimes(1);
  });

  test('schedules a retry after stream error when a read was pending', async () => {
    vi.useFakeTimers();

    let firstStream: EventEmitter | undefined;

    mockStatSync.mockReturnValue({ size: 100 } as ReturnType<typeof statSync>);
    mockCreateReadStream.mockImplementationOnce(() => {
      firstStream = new EventEmitter();
      return firstStream as unknown as ReturnType<typeof createReadStream>;
    });
    mockCreateReadStream.mockImplementation(() => new EventEmitter() as unknown as ReturnType<typeof createReadStream>);
    mockWatch.mockReturnValue({ close: vi.fn() } as unknown as ReturnType<typeof watch>);

    void followFile('/tmp/test.log', 0);
    await Promise.resolve();

    // First createReadStream call happened (from immediate readNewContent after watcher setup)
    expect(mockCreateReadStream).toHaveBeenCalledTimes(1);
    expect(firstStream).toBeDefined();

    // Retrieve the watch callback to trigger a pending read while the first stream is active
    const [, watchListener] = mockWatch.mock.calls[0] as [unknown, () => void];

    // While the first stream is still reading, trigger another read — sets readRequested = true
    watchListener();

    // Emit error on the first stream — should schedule a retry via setTimeout
    (firstStream as EventEmitter).emit('error', new Error('read error'));

    // Advance fake timers to trigger the 100ms retry
    await vi.advanceTimersByTimeAsync(100);

    // A second createReadStream call should have happened for the retry
    expect(mockCreateReadStream).toHaveBeenCalledTimes(2);
  });
});
