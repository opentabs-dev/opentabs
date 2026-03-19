import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installLogCollector, LogCollector } from './log-collector.js';

describe('LogCollector', () => {
  describe('capture and getEntries', () => {
    test('captures a single entry and retrieves it', () => {
      const collector = new LogCollector('background');
      collector.capture('log', ['hello']);
      const entries = collector.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.message).toBe('hello');
      expect(entries[0]?.level).toBe('log');
      expect(entries[0]?.source).toBe('background');
    });

    test('captures multiple entries across levels', () => {
      const collector = new LogCollector('offscreen');
      collector.capture('log', ['msg1']);
      collector.capture('warn', ['msg2']);
      collector.capture('error', ['msg3']);
      collector.capture('info', ['msg4']);
      expect(collector.getEntries()).toHaveLength(4);
    });

    test('formats multiple arguments as space-separated string', () => {
      const collector = new LogCollector('background');
      collector.capture('log', ['hello', 'world', 42]);
      const entries = collector.getEntries();
      expect(entries[0]?.message).toBe('hello world 42');
    });

    test('formats Error objects with message and stack', () => {
      const collector = new LogCollector('background');
      const err = new Error('test error');
      collector.capture('error', [err]);
      const entries = collector.getEntries();
      expect(entries[0]?.message).toContain('test error');
    });

    test('formats objects as JSON', () => {
      const collector = new LogCollector('background');
      collector.capture('log', [{ key: 'value' }]);
      const entries = collector.getEntries();
      expect(entries[0]?.message).toBe('{"key":"value"}');
    });

    test('handles circular references gracefully', () => {
      const collector = new LogCollector('background');
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      collector.capture('log', [obj]);
      const entries = collector.getEntries();
      // JSON.stringify fails on circular refs, falls back to String()
      expect(entries[0]?.message).toBe('[object Object]');
    });

    test('truncates messages over 2000 characters', () => {
      const collector = new LogCollector('background');
      const longString = 'A'.repeat(3000);
      collector.capture('log', [longString]);
      const entries = collector.getEntries();
      expect(entries[0]?.message).toHaveLength(2000);
    });

    test('does not truncate messages at exactly 2000 characters', () => {
      const collector = new LogCollector('background');
      const exactString = 'B'.repeat(2000);
      collector.capture('log', [exactString]);
      const entries = collector.getEntries();
      expect(entries[0]?.message).toHaveLength(2000);
      expect(entries[0]?.message).toBe(exactString);
    });

    test('sets timestamp on captured entries', () => {
      const collector = new LogCollector('background');
      const before = Date.now();
      collector.capture('log', ['test']);
      const after = Date.now();
      const entries = collector.getEntries();
      const ts = entries[0]?.timestamp ?? 0;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe('getEntries ordering', () => {
    test('returns entries in newest-first order', () => {
      const collector = new LogCollector('background');
      collector.capture('log', ['first']);
      collector.capture('log', ['second']);
      collector.capture('log', ['third']);
      const entries = collector.getEntries();
      const messages = entries.map(e => e.message);
      expect(messages).toEqual(['third', 'second', 'first']);
    });
  });

  describe('getEntries filtering', () => {
    let collector: LogCollector;

    beforeEach(() => {
      collector = new LogCollector('background');
      collector.capture('log', ['log msg']);
      collector.capture('warn', ['warn msg']);
      collector.capture('error', ['error msg']);
      collector.capture('info', ['info msg']);
    });

    test('filters by level', () => {
      const entries = collector.getEntries({ level: 'warn' });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe('warn');
    });

    test('filters by source (matches own source)', () => {
      const entries = collector.getEntries({ source: 'background' });
      expect(entries).toHaveLength(4);
    });

    test('filters by source (no match for different source)', () => {
      const entries = collector.getEntries({ source: 'offscreen' });
      expect(entries).toHaveLength(0);
    });

    test('filters by since timestamp', () => {
      const cutoff = Date.now() - 1000;
      const entries = collector.getEntries({ since: cutoff });
      expect(entries.length).toBeGreaterThan(0);
    });

    test('limits number of returned entries', () => {
      const entries = collector.getEntries({ limit: 2 });
      expect(entries).toHaveLength(2);
      // Newest first, so limit returns the 2 most recent
      expect(entries[0]?.message).toBe('info msg');
      expect(entries[1]?.message).toBe('error msg');
    });

    test('limit larger than buffer returns all entries', () => {
      const entries = collector.getEntries({ limit: 100 });
      expect(entries).toHaveLength(4);
    });

    test('combines level and limit filters', () => {
      collector.capture('warn', ['another warn']);
      const entries = collector.getEntries({ level: 'warn', limit: 1 });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.message).toBe('another warn');
    });
  });

  describe('circular buffer capacity', () => {
    test('evicts oldest entries when capacity is exceeded', () => {
      const collector = new LogCollector('background', 3);
      collector.capture('log', ['a']);
      collector.capture('log', ['b']);
      collector.capture('log', ['c']);
      collector.capture('log', ['d']);
      const entries = collector.getEntries();
      expect(entries).toHaveLength(3);
      // Newest first
      const messages = entries.map(e => e.message);
      expect(messages).toEqual(['d', 'c', 'b']);
    });

    test('entries remain in correct order after multiple evictions', () => {
      const collector = new LogCollector('background', 2);
      collector.capture('log', ['a']);
      collector.capture('log', ['b']);
      collector.capture('log', ['c']);
      collector.capture('log', ['d']);
      collector.capture('log', ['e']);
      const entries = collector.getEntries();
      const messages = entries.map(e => e.message);
      expect(messages).toEqual(['e', 'd']);
    });

    test('default capacity is 500', () => {
      const collector = new LogCollector('background');
      for (let i = 0; i < 600; i++) {
        collector.capture('log', [`msg-${String(i)}`]);
      }
      const entries = collector.getEntries();
      expect(entries).toHaveLength(500);
      // Most recent entry should be the last captured
      expect(entries[0]?.message).toBe('msg-599');
      // Oldest in buffer should be msg-100 (entries 0–99 evicted)
      expect(entries[499]?.message).toBe('msg-100');
    });
  });

  describe('clear', () => {
    test('removes all entries from buffer', () => {
      const collector = new LogCollector('background');
      collector.capture('log', ['a']);
      collector.capture('log', ['b']);
      expect(collector.getEntries()).toHaveLength(2);
      collector.clear();
      expect(collector.getEntries()).toHaveLength(0);
    });

    test('allows new entries after clearing', () => {
      const collector = new LogCollector('background');
      collector.capture('log', ['before']);
      collector.clear();
      collector.capture('log', ['after']);
      const entries = collector.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.message).toBe('after');
    });
  });

  describe('getStats', () => {
    test('returns zeros for empty collector', () => {
      const collector = new LogCollector('background');
      const stats = collector.getStats();
      expect(stats.totalCaptured).toBe(0);
      expect(stats.bufferSize).toBe(0);
      expect(stats.oldestTimestamp).toBeNull();
      expect(stats.newestTimestamp).toBeNull();
    });

    test('tracks totalCaptured across all entries (including evicted)', () => {
      const collector = new LogCollector('background', 2);
      collector.capture('log', ['a']);
      collector.capture('log', ['b']);
      collector.capture('log', ['c']);
      const stats = collector.getStats();
      expect(stats.totalCaptured).toBe(3);
      expect(stats.bufferSize).toBe(2);
    });

    test('reports oldest and newest timestamps', () => {
      const collector = new LogCollector('background');
      collector.capture('log', ['first']);
      const firstTs = collector.getStats().oldestTimestamp;
      collector.capture('log', ['second']);
      const stats = collector.getStats();
      expect(stats.oldestTimestamp).toBe(firstTs);
      expect(stats.newestTimestamp).toBeGreaterThanOrEqual(firstTs ?? 0);
    });

    test('totalCaptured persists across clear', () => {
      const collector = new LogCollector('background');
      collector.capture('log', ['a']);
      collector.capture('log', ['b']);
      collector.clear();
      // totalCaptured is not reset by clear — it tracks all-time capture count
      const stats = collector.getStats();
      expect(stats.totalCaptured).toBe(2);
      expect(stats.bufferSize).toBe(0);
    });
  });
});

describe('installLogCollector', () => {
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let originalInfo: typeof console.info;

  beforeEach(() => {
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    originalInfo = console.info;
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    console.info = originalInfo;
  });

  test('wraps console methods and captures entries', () => {
    const collector = installLogCollector('background');
    console.log('test log');
    console.warn('test warn');
    console.error('test error');
    console.info('test info');
    const entries = collector.getEntries();
    expect(entries).toHaveLength(4);
    const levels = entries.map(e => e.level);
    expect(levels).toContain('log');
    expect(levels).toContain('warn');
    expect(levels).toContain('error');
    expect(levels).toContain('info');
  });

  test('still calls original console methods', () => {
    const calls: string[] = [];
    console.log = (...args: unknown[]) => {
      calls.push(`log:${String(args[0])}`);
    };
    const collector = installLogCollector('offscreen');
    console.log('hello');
    expect(calls).toContain('log:hello');
    expect(collector.getEntries()).toHaveLength(1);
  });

  test('uses the specified source for all entries', () => {
    const collector = installLogCollector('side-panel');
    console.log('test');
    const entries = collector.getEntries();
    expect(entries[0]?.source).toBe('side-panel');
  });

  test('respects custom maxEntries', () => {
    const collector = installLogCollector('background', 2);
    console.log('a');
    console.log('b');
    console.log('c');
    expect(collector.getEntries()).toHaveLength(2);
  });
});
