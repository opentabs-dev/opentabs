import { appendLog, clearAllLogs, getBufferedPlugins, getLogCount, getLogs, pruneStaleBuffers } from './log-buffer.js';
import { afterEach, describe, expect, test } from 'bun:test';
import type { PluginLogEntry } from './log-buffer.js';

const makeEntry = (plugin: string, message: string, overrides?: Partial<PluginLogEntry>): PluginLogEntry => ({
  level: 'info',
  plugin,
  message,
  data: undefined,
  ts: new Date().toISOString(),
  ...overrides,
});

/** Extract message strings from log entries for easy assertion */
const messages = (entries: PluginLogEntry[]): string[] => entries.map(e => e.message);

afterEach(() => {
  clearAllLogs();
});

describe('appendLog', () => {
  test('adds an entry to a new plugin buffer', () => {
    appendLog('slack', makeEntry('slack', 'hello'));

    expect(getLogCount('slack')).toBe(1);
  });

  test('adds multiple entries to the same plugin', () => {
    appendLog('slack', makeEntry('slack', 'one'));
    appendLog('slack', makeEntry('slack', 'two'));
    appendLog('slack', makeEntry('slack', 'three'));

    expect(getLogCount('slack')).toBe(3);
  });

  test('creates independent buffers per plugin', () => {
    appendLog('slack', makeEntry('slack', 'slack-msg'));
    appendLog('github', makeEntry('github', 'github-msg'));

    expect(getLogCount('slack')).toBe(1);
    expect(getLogCount('github')).toBe(1);
  });
});

describe('getLogs', () => {
  test('returns empty array for unknown plugin', () => {
    expect(getLogs('nonexistent')).toEqual([]);
  });

  test('returns empty array for plugin with no entries', () => {
    expect(getLogs('slack')).toEqual([]);
  });

  test('returns entries in chronological order (oldest first)', () => {
    appendLog('slack', makeEntry('slack', 'first'));
    appendLog('slack', makeEntry('slack', 'second'));
    appendLog('slack', makeEntry('slack', 'third'));

    const logs = getLogs('slack');

    expect(logs).toHaveLength(3);
    expect(messages(logs)).toEqual(['first', 'second', 'third']);
  });

  test('respects limit parameter returning only the most recent entries', () => {
    appendLog('slack', makeEntry('slack', 'first'));
    appendLog('slack', makeEntry('slack', 'second'));
    appendLog('slack', makeEntry('slack', 'third'));

    const logs = getLogs('slack', 2);

    expect(logs).toHaveLength(2);
    expect(messages(logs)).toEqual(['second', 'third']);
  });

  test('returns all entries when limit exceeds buffer size', () => {
    appendLog('slack', makeEntry('slack', 'first'));
    appendLog('slack', makeEntry('slack', 'second'));

    const logs = getLogs('slack', 100);

    expect(logs).toHaveLength(2);
    expect(messages(logs)).toEqual(['first', 'second']);
  });

  test('returns all entries when limit is undefined', () => {
    for (let i = 0; i < 5; i++) {
      appendLog('slack', makeEntry('slack', `msg-${i}`));
    }

    expect(getLogs('slack')).toHaveLength(5);
  });

  test('preserves entry fields accurately', () => {
    const entry = makeEntry('slack', 'test-msg', {
      level: 'error',
      data: { key: 'value' },
      ts: '2026-01-01T00:00:00.000Z',
    });
    appendLog('slack', entry);

    const [first] = getLogs('slack');
    if (!first) throw new Error('Expected one log entry');

    expect(first.level).toBe('error');
    expect(first.plugin).toBe('slack');
    expect(first.message).toBe('test-msg');
    expect(first.data).toEqual({ key: 'value' });
    expect(first.ts).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('circular buffer behavior', () => {
  test('evicts oldest entries when capacity (1000) is exceeded', () => {
    for (let i = 0; i < 1005; i++) {
      appendLog('slack', makeEntry('slack', `msg-${i}`));
    }

    expect(getLogCount('slack')).toBe(1000);

    const logs = getLogs('slack');
    expect(logs).toHaveLength(1000);
    // The first 5 entries (msg-0 through msg-4) should be evicted
    const msgs = messages(logs);
    expect(msgs.at(0)).toBe('msg-5');
    expect(msgs.at(-1)).toBe('msg-1004');
  });

  test('maintains chronological order after wrapping', () => {
    for (let i = 0; i < 1050; i++) {
      appendLog('slack', makeEntry('slack', `msg-${i}`));
    }

    const msgs = messages(getLogs('slack'));

    // Verify sequential ordering across the wrap boundary
    for (let i = 1; i < msgs.length; i++) {
      const prev = msgs[i - 1];
      const curr = msgs[i];
      if (!prev || !curr) throw new Error('Unexpected missing entry');
      const prevNum = parseInt(prev.split('-')[1] ?? '');
      const currNum = parseInt(curr.split('-')[1] ?? '');
      expect(currNum).toBe(prevNum + 1);
    }
  });

  test('limit works correctly after buffer has wrapped', () => {
    for (let i = 0; i < 1010; i++) {
      appendLog('slack', makeEntry('slack', `msg-${i}`));
    }

    const logs = getLogs('slack', 3);

    expect(logs).toHaveLength(3);
    expect(messages(logs)).toEqual(['msg-1007', 'msg-1008', 'msg-1009']);
  });
});

describe('getLogCount', () => {
  test('returns 0 for unknown plugin', () => {
    expect(getLogCount('nonexistent')).toBe(0);
  });

  test('tracks count accurately as entries are added', () => {
    expect(getLogCount('slack')).toBe(0);

    appendLog('slack', makeEntry('slack', 'one'));
    expect(getLogCount('slack')).toBe(1);

    appendLog('slack', makeEntry('slack', 'two'));
    expect(getLogCount('slack')).toBe(2);
  });

  test('caps at 1000 when buffer overflows', () => {
    for (let i = 0; i < 1500; i++) {
      appendLog('slack', makeEntry('slack', `msg-${i}`));
    }

    expect(getLogCount('slack')).toBe(1000);
  });

  test('tracks counts independently per plugin', () => {
    appendLog('slack', makeEntry('slack', 'a'));
    appendLog('slack', makeEntry('slack', 'b'));
    appendLog('github', makeEntry('github', 'c'));

    expect(getLogCount('slack')).toBe(2);
    expect(getLogCount('github')).toBe(1);
  });
});

describe('getBufferedPlugins', () => {
  test('returns empty array when no plugins have logs', () => {
    expect(getBufferedPlugins()).toEqual([]);
  });

  test('returns plugin names that have buffered entries', () => {
    appendLog('slack', makeEntry('slack', 'a'));
    appendLog('github', makeEntry('github', 'b'));

    const plugins = getBufferedPlugins();

    expect(plugins).toHaveLength(2);
    expect(plugins).toContain('slack');
    expect(plugins).toContain('github');
  });

  test('includes plugin even after buffer wraps', () => {
    for (let i = 0; i < 1010; i++) {
      appendLog('slack', makeEntry('slack', `msg-${i}`));
    }

    expect(getBufferedPlugins()).toContain('slack');
  });
});

describe('pruneStaleBuffers', () => {
  test('removes buffers for plugins not in the active set', () => {
    appendLog('slack', makeEntry('slack', 'a'));
    appendLog('github', makeEntry('github', 'b'));
    appendLog('jira', makeEntry('jira', 'c'));

    pruneStaleBuffers(new Set(['slack']));

    expect(getLogCount('slack')).toBe(1);
    expect(getLogCount('github')).toBe(0);
    expect(getLogCount('jira')).toBe(0);
    expect(getBufferedPlugins()).toEqual(['slack']);
  });

  test('preserves buffers for all active plugins', () => {
    appendLog('slack', makeEntry('slack', 'a'));
    appendLog('github', makeEntry('github', 'b'));

    pruneStaleBuffers(new Set(['slack', 'github']));

    expect(getLogCount('slack')).toBe(1);
    expect(getLogCount('github')).toBe(1);
  });

  test('removes all buffers when active set is empty', () => {
    appendLog('slack', makeEntry('slack', 'a'));
    appendLog('github', makeEntry('github', 'b'));

    pruneStaleBuffers(new Set());

    expect(getBufferedPlugins()).toEqual([]);
  });

  test('is a no-op when no buffers exist', () => {
    pruneStaleBuffers(new Set(['slack']));

    expect(getBufferedPlugins()).toEqual([]);
  });
});

describe('clearAllLogs', () => {
  test('removes all buffered entries for all plugins', () => {
    appendLog('slack', makeEntry('slack', 'a'));
    appendLog('github', makeEntry('github', 'b'));

    clearAllLogs();

    expect(getLogCount('slack')).toBe(0);
    expect(getLogCount('github')).toBe(0);
    expect(getLogs('slack')).toEqual([]);
    expect(getLogs('github')).toEqual([]);
    expect(getBufferedPlugins()).toEqual([]);
  });

  test('allows new entries after clearing', () => {
    appendLog('slack', makeEntry('slack', 'before'));
    clearAllLogs();
    appendLog('slack', makeEntry('slack', 'after'));

    expect(getLogCount('slack')).toBe(1);
    expect(messages(getLogs('slack'))).toEqual(['after']);
  });
});
