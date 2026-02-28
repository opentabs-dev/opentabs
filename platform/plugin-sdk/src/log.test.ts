import { _setLogTransport, log } from './log.js';
import { afterEach, describe, expect, vi, test } from 'vitest';
import type { LogEntry } from './log.js';

describe('sdk.log', () => {
  // Restore the default transport after each test
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  test('log namespace is frozen', () => {
    expect(Object.isFrozen(log)).toBe(true);
  });

  test('log.debug/info/warn/error are functions', () => {
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  test('log methods emit entries with correct levels', () => {
    const entries: LogEntry[] = [];
    restore = _setLogTransport(entry => entries.push(entry));

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(entries).toHaveLength(4);
    expect(entries[0]?.level).toBe('debug');
    expect(entries[1]?.level).toBe('info');
    expect(entries[2]?.level).toBe('warning');
    expect(entries[3]?.level).toBe('error');
  });

  test('log entries include message, data array, and ISO timestamp', () => {
    const entries: LogEntry[] = [];
    restore = _setLogTransport(entry => entries.push(entry));

    log.info('hello', 42, { key: 'val' });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.message).toBe('hello');
    expect(entry?.data).toEqual([42, { key: 'val' }]);
    expect(entry?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('_setLogTransport replaces the transport', () => {
    const entries: LogEntry[] = [];
    restore = _setLogTransport(entry => entries.push(entry));

    log.info('routed');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('routed');
  });

  test('_setLogTransport returns a restore function', () => {
    const entries: LogEntry[] = [];
    const restoreFn = _setLogTransport(entry => entries.push(entry));

    log.info('before');
    restoreFn();

    // After restoring, logs should go to console (default transport), not our collector
    const consoleMock = vi.fn(() => {});
    const originalInfo = console.info;
    console.info = consoleMock;
    try {
      log.info('after');
    } finally {
      console.info = originalInfo;
    }

    expect(entries).toHaveLength(1);
    expect(consoleMock).toHaveBeenCalled();
    // Don't keep restore since we already restored
    restore = undefined;
  });

  test('default transport calls console methods', () => {
    const mocks = {
      debug: vi.fn(() => {}),
      info: vi.fn(() => {}),
      warn: vi.fn(() => {}),
      error: vi.fn(() => {}),
    };

    const originals = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    console.debug = mocks.debug;
    console.info = mocks.info;
    console.warn = mocks.warn;
    console.error = mocks.error;

    try {
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');

      expect(mocks.debug).toHaveBeenCalledTimes(1);
      expect(mocks.info).toHaveBeenCalledTimes(1);
      expect(mocks.warn).toHaveBeenCalledTimes(1);
      expect(mocks.error).toHaveBeenCalledTimes(1);
    } finally {
      console.debug = originals.debug;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
    }
  });
});

describe('global registration', () => {
  test('globalThis.__openTabs._setLogTransport is a function', () => {
    const ot = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown>;
    expect(typeof ot['_setLogTransport']).toBe('function');
  });

  test('globalThis.__openTabs.log is the exported log object', () => {
    const ot = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown>;
    expect(ot['log']).toBe(log);
  });
});

describe('safe serialization', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  const collect = (): LogEntry[] => {
    const entries: LogEntry[] = [];
    restore = _setLogTransport(entry => entries.push(entry));
    return entries;
  };

  test('serializes primitives as-is', () => {
    const entries = collect();
    log.info('test', 42, true, null, undefined, 'hello');

    expect(entries[0]?.data).toEqual([42, true, null, undefined, 'hello']);
  });

  test('serializes functions as descriptive strings', () => {
    const entries = collect();
    const myFunc = () => {};
    Object.defineProperty(myFunc, 'name', { value: 'myFunc' });
    log.info('test', myFunc);

    expect(entries[0]?.data).toEqual(['[Function: myFunc]']);
  });

  test('serializes symbols as descriptive strings', () => {
    const entries = collect();
    log.info('test', Symbol('mySymbol'));

    expect(entries[0]?.data).toEqual(['[Symbol: mySymbol]']);
  });

  test('serializes bigints as descriptive strings', () => {
    const entries = collect();
    log.info('test', BigInt(123));

    expect(entries[0]?.data).toEqual(['[BigInt: 123]']);
  });

  test('handles circular references', () => {
    const entries = collect();
    const obj: Record<string, unknown> = { a: 1 };
    obj['self'] = obj;
    log.info('test', obj);

    const data = entries[0]?.data[0] as Record<string, unknown> | undefined;
    expect(data?.['a']).toBe(1);
    expect(data?.['self']).toBe('[Circular]');
  });

  test('truncates long strings', () => {
    const entries = collect();
    const longString = 'x'.repeat(5000);
    log.info('test', longString);

    const result = entries[0]?.data[0] as string | undefined;
    expect(result?.length).toBeLessThanOrEqual(4097); // 4096 + '…'
    expect(result?.endsWith('…')).toBe(true);
  });

  test('caps data array at 10 items', () => {
    const entries = collect();
    log.info('test', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);

    expect(entries[0]?.data).toHaveLength(10);
  });

  test('serializes Error instances', () => {
    const entries = collect();
    const err = new Error('boom');
    err.name = 'TestError';
    log.info('test', err);

    const data = entries[0]?.data[0] as { name: string; message: string } | undefined;
    expect(data?.name).toBe('TestError');
    expect(data?.message).toBe('boom');
  });

  test('serializes HTML element-like objects as [TAG#id.class]', () => {
    const entries = collect();
    // Simulates an HTML element (nodeType + nodeName + string className)
    const div = { nodeType: 1, nodeName: 'DIV', id: 'myId', className: 'myClass otherClass' };
    log.info('test', div);

    expect(entries[0]?.data[0]).toBe('[DIV#myId.myClass]');
  });

  test('serializes SVG element-like objects (SVGAnimatedString className) without throwing', () => {
    const entries = collect();
    // Simulates an SVG element whose className is an SVGAnimatedString
    const svg = {
      nodeType: 1,
      nodeName: 'svg',
      id: 'myId',
      className: { baseVal: 'myClass', animVal: 'myClass' },
    };
    log.info('test', svg);

    expect(entries[0]?.data[0]).toBe('[svg#myId.myClass]');
  });

  test('non-DOM object with numeric nodeType falls through to JSON serialization', () => {
    const entries = collect();
    // A POJO with nodeType but no nodeName — should not be treated as a DOM node
    const pojo = { nodeType: 1, className: 42 };
    log.info('test', pojo);

    const data = entries[0]?.data[0] as Record<string, unknown> | undefined;
    expect(data?.['nodeType']).toBe(1);
    expect(data?.['className']).toBe(42);
  });

  test('safeSerializeArg never throws for any input', () => {
    const entries = collect();
    // None of these should throw
    expect(() => {
      log.info(
        'test',
        { nodeType: 1, className: 42 }, // POJO with non-string className
        { nodeType: 1, nodeName: 'svg', className: { baseVal: '' } }, // SVG-like with empty baseVal
        { nodeType: 1, nodeName: 'DIV', className: '' }, // HTML-like with empty className
      );
    }).not.toThrow();
    expect(entries[0]?.data).toHaveLength(3);
  });

  test('serializes anonymous functions as [Function: anonymous]', () => {
    const entries = collect();
    log.info('test', () => {});

    expect(entries[0]?.data).toEqual(['[Function: anonymous]']);
  });

  test('objects with throwing property getters serialize to fallback string without crashing', () => {
    const entries = collect();
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, 'nodeType', {
      get() {
        throw new Error('getter threw');
      },
      configurable: true,
    });

    expect(() => log.info('test', obj)).not.toThrow();
    const result = entries[0]?.data[0] as string | undefined;
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^\[Unserializable:/);
  });
});
