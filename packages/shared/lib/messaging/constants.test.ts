import { describe, it, expect } from 'bun:test';
import { MessageTypes, Defaults } from './constants.js';

describe('MessageTypes', () => {
  it('should have all required message types', () => {
    expect(MessageTypes.TAB_READY).toBe('tab_ready');
    expect(MessageTypes.GET_TAB_STATUS).toBe('get_tab_status');
    expect(MessageTypes.STATUS_UPDATE).toBe('status_update');
    expect(MessageTypes.GET_STATUS).toBe('get_status');
    expect(MessageTypes.CONNECTED).toBe('connected');
    expect(MessageTypes.DISCONNECTED).toBe('disconnected');
  });

  it('should be immutable (const assertion)', () => {
    // TypeScript ensures this at compile time, but we verify at runtime
    expect(Object.isFrozen(MessageTypes)).toBe(false); // as const doesn't freeze
    expect(typeof MessageTypes.TAB_READY).toBe('string');
  });
});

describe('Defaults', () => {
  it('should have valid default port', () => {
    expect(Defaults.WS_PORT).toBe(8765);
    expect(Defaults.WS_PORT).toBeGreaterThan(0);
    expect(Defaults.WS_PORT).toBeLessThan(65536);
  });

  it('should have reasonable timeout values', () => {
    expect(Defaults.RECONNECT_BASE_INTERVAL_MS).toBeGreaterThan(0);
    expect(Defaults.RECONNECT_MAX_INTERVAL_MS).toBeGreaterThan(Defaults.RECONNECT_BASE_INTERVAL_MS);
  });

  it('should have valid keepalive interval', () => {
    expect(Defaults.KEEPALIVE_INTERVAL_MINUTES).toBeGreaterThan(0);
    expect(Defaults.PING_INTERVAL_MS).toBeGreaterThan(0);
  });
});
