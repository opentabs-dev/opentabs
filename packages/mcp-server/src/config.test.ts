import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { parseConfig, ConfigError, DEFAULT_HTTP_PORT, DEFAULT_WS_PORT, DEFAULT_HTTP_HOST } from './config.js';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('parseConfig', () => {
    it('should return default config when no args provided', () => {
      const config = parseConfig([]);

      expect(config).toEqual({
        mode: 'http',
        httpPort: DEFAULT_HTTP_PORT,
        wsPort: DEFAULT_WS_PORT,
        httpHost: DEFAULT_HTTP_HOST,
      });
    });

    it('should parse --stdio flag', () => {
      const config = parseConfig(['--stdio']);

      expect(config.mode).toBe('stdio');
    });

    it('should parse --http flag', () => {
      const config = parseConfig(['--http']);

      expect(config.mode).toBe('http');
    });

    it('should parse --port with separate value', () => {
      const config = parseConfig(['--port', '4000']);

      expect(config.httpPort).toBe(4000);
    });

    it('should parse -p shorthand', () => {
      const config = parseConfig(['-p', '4001']);

      expect(config.httpPort).toBe(4001);
    });

    it('should parse --port= format', () => {
      const config = parseConfig(['--port=4002']);

      expect(config.httpPort).toBe(4002);
    });

    it('should parse --ws-port with separate value', () => {
      const config = parseConfig(['--ws-port', '9000']);

      expect(config.wsPort).toBe(9000);
    });

    it('should parse --ws-port= format', () => {
      const config = parseConfig(['--ws-port=9001']);

      expect(config.wsPort).toBe(9001);
    });

    it('should parse --host with separate value', () => {
      const config = parseConfig(['--host', '0.0.0.0']);

      expect(config.httpHost).toBe('0.0.0.0');
    });

    it('should parse --host= format', () => {
      const config = parseConfig(['--host=localhost']);

      expect(config.httpHost).toBe('localhost');
    });

    it('should parse multiple options', () => {
      const config = parseConfig(['--stdio', '--port', '5000', '--ws-port', '9999', '--host', '0.0.0.0']);

      expect(config).toEqual({
        mode: 'stdio',
        httpPort: 5000,
        wsPort: 9999,
        httpHost: '0.0.0.0',
      });
    });

    it('should read MCP_HTTP_PORT from environment', () => {
      process.env.MCP_HTTP_PORT = '6000';
      const config = parseConfig([]);

      expect(config.httpPort).toBe(6000);
    });

    it('should read OPENTABS_PORT from environment', () => {
      process.env.OPENTABS_PORT = '9500';
      const config = parseConfig([]);

      expect(config.wsPort).toBe(9500);
    });

    it('should read MCP_HTTP_HOST from environment', () => {
      process.env.MCP_HTTP_HOST = '0.0.0.0';
      const config = parseConfig([]);

      expect(config.httpHost).toBe('0.0.0.0');
    });

    it('should prefer CLI args over environment variables', () => {
      process.env.MCP_HTTP_PORT = '6000';
      const config = parseConfig(['--port', '7000']);

      expect(config.httpPort).toBe(7000);
    });

    it('should throw ConfigError for invalid HTTP port', () => {
      expect(() => parseConfig(['--port', 'invalid'])).toThrow(ConfigError);
      expect(() => parseConfig(['--port', 'invalid'])).toThrow('Invalid HTTP port');
    });

    it('should throw ConfigError for out-of-range HTTP port', () => {
      expect(() => parseConfig(['--port', '0'])).toThrow(ConfigError);
      expect(() => parseConfig(['--port', '70000'])).toThrow(ConfigError);
    });

    it('should throw ConfigError for invalid WebSocket port', () => {
      expect(() => parseConfig(['--ws-port', 'abc'])).toThrow(ConfigError);
      expect(() => parseConfig(['--ws-port', 'abc'])).toThrow('Invalid WebSocket port');
    });

    it('should throw ConfigError for invalid environment port', () => {
      process.env.MCP_HTTP_PORT = 'not-a-number';
      expect(() => parseConfig([])).toThrow(ConfigError);
    });
  });

  describe('default constants', () => {
    it('should export DEFAULT_HTTP_PORT as 3000', () => {
      expect(DEFAULT_HTTP_PORT).toBe(3000);
    });

    it('should export DEFAULT_WS_PORT as 8765', () => {
      expect(DEFAULT_WS_PORT).toBe(8765);
    });

    it('should export DEFAULT_HTTP_HOST as 127.0.0.1', () => {
      expect(DEFAULT_HTTP_HOST).toBe('127.0.0.1');
    });
  });
});
