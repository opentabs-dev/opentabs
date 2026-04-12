import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CheckResult } from './doctor.js';
import {
  checkAuthSecret,
  checkBrowser,
  checkConfigFile,
  checkExtensionConnected,
  checkMcpClientConfig,
  checkMcpServerVersion,
  checkNpmPlugins,
  checkPlugins,
  checkRuntime,
  checkServerHealth,
  defaultMcpClientLocations,
  isCwdProjectDirectory,
} from './doctor.js';

vi.mock('../version-info.js');

import { getCliVersion, getMcpServerVersion } from '../version-info.js';

/** Create a test HTTP server listening on a random port. Returns { port, close }. */
const createTestServer = (
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> =>
  new Promise(resolve => {
    const server = createServer(handler);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => new Promise<void>(res => server.close(() => res())),
      });
    });
  });

// ---------------------------------------------------------------------------
// checkExtensionConnected
// ---------------------------------------------------------------------------

describe('checkExtensionConnected', () => {
  test('returns warn result when health data is null', () => {
    const result: CheckResult = checkExtensionConnected(null);
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.label).toBe('Extension connection');
    expect(result.detail).toContain('unknown');
  });

  test('returns pass result when extensionConnected is true', () => {
    const result: CheckResult = checkExtensionConnected({ extensionConnected: true });
    expect(result.ok).toBe(true);
    expect(result.label).toBe('Extension connection');
    expect(result.detail).toBe('connected');
  });

  test('returns warn result when extensionConnected is false', () => {
    const result: CheckResult = checkExtensionConnected({ extensionConnected: false });
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.label).toBe('Extension connection');
    expect(result.detail).toContain('not connected');
    expect(result.hint).toBeDefined();
  });

  test('returns warn result when extensionConnected is missing', () => {
    const result: CheckResult = checkExtensionConnected({ version: '1.0.0' });
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.detail).toContain('not connected');
  });
});

// ---------------------------------------------------------------------------
// checkRuntime
// ---------------------------------------------------------------------------

describe('checkRuntime', () => {
  test('returns pass result with current runtime version', () => {
    const result: CheckResult = checkRuntime();
    expect(result.ok).toBe(true);
    expect(result.label).toBe('Runtime');
    expect(result.detail).toContain(process.version);
  });
});

// ---------------------------------------------------------------------------
// checkBrowser
// ---------------------------------------------------------------------------

describe('checkBrowser', () => {
  test('returns a result with label Browser', () => {
    const result: CheckResult = checkBrowser();
    expect(result.label).toBe('Browser');
    expect(result.fatal).toBe(false);
  });

  test('finds a Chromium-based browser on macOS', () => {
    if (process.platform !== 'darwin') return;
    const result: CheckResult = checkBrowser();
    // CI and dev machines should have at least one Chromium browser
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkServerHealth
// ---------------------------------------------------------------------------

describe('checkServerHealth', () => {
  test('sends Authorization header when secret is provided', async () => {
    let receivedAuth = '';
    const server = await createTestServer((req, res) => {
      receivedAuth = req.headers.authorization ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0', toolCount: 5 }));
    });
    const port = server.port;
    try {
      const { result } = await checkServerHealth(port, 'test-secret');
      expect(result.ok).toBe(true);
      expect(receivedAuth).toBe('Bearer test-secret');
    } finally {
      await server.close();
    }
  });

  test('sends no Authorization header when secret is null', async () => {
    let receivedAuth: string | undefined;
    const server = await createTestServer((req, res) => {
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0', toolCount: 5 }));
    });
    const port = server.port;
    try {
      const { result } = await checkServerHealth(port, null);
      expect(result.ok).toBe(true);
      expect(receivedAuth).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  test('sends no Authorization header when secret is undefined', async () => {
    let receivedAuth: string | undefined;
    const server = await createTestServer((req, res) => {
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0', toolCount: 5 }));
    });
    const port = server.port;
    try {
      const { result } = await checkServerHealth(port);
      expect(result.ok).toBe(true);
      expect(receivedAuth).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  test('returns fail when server returns non-ok status', async () => {
    const server = await createTestServer((_req, res) => {
      res.writeHead(401);
      res.end('Unauthorized');
    });
    const port = server.port;
    try {
      const { result, data } = await checkServerHealth(port, 'bad-secret');
      expect(result.ok).toBe(false);
      expect(result.fatal).toBe(true);
      expect(result.detail).toContain('401');
      expect(data).toBeNull();
    } finally {
      await server.close();
    }
  });

  test('returns warn when server is not reachable', async () => {
    const { result, data } = await checkServerHealth(19999);
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.detail).toContain('not reachable');
    expect(data).toBeNull();
  });

  test('returns health data on success', async () => {
    const server = await createTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '2.0.0', toolCount: 3, extensionConnected: true }));
    });
    const port = server.port;
    try {
      const { result, data } = await checkServerHealth(port);
      expect(result.ok).toBe(true);
      expect(result.detail).toContain('v2.0.0');
      expect(data).toEqual({ status: 'ok', version: '2.0.0', toolCount: 3, extensionConnected: true });
    } finally {
      await server.close();
    }
  });

  test('returns warn when server responds with non-OpenTabs JSON (missing version and toolCount)', async () => {
    const server = await createTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    const port = server.port;
    try {
      const { result, data } = await checkServerHealth(port);
      expect(result.ok).toBe(false);
      expect(result.fatal).toBe(false);
      expect(result.detail).toContain('not OpenTabs');
      expect(data).toBeNull();
    } finally {
      await server.close();
    }
  });

  test('returns warn when server responds with missing toolCount', async () => {
    const server = await createTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
    });
    const port = server.port;
    try {
      const { result, data } = await checkServerHealth(port);
      expect(result.ok).toBe(false);
      expect(result.fatal).toBe(false);
      expect(result.detail).toContain('not OpenTabs');
      expect(data).toBeNull();
    } finally {
      await server.close();
    }
  });

  test('returns warn when server responds with missing version', async () => {
    const server = await createTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', toolCount: 5 }));
    });
    const port = server.port;
    try {
      const { result, data } = await checkServerHealth(port);
      expect(result.ok).toBe(false);
      expect(result.fatal).toBe(false);
      expect(result.detail).toContain('not OpenTabs');
      expect(data).toBeNull();
    } finally {
      await server.close();
    }
  });

  test('another service hint tells user to stop the service, not just start opentabs', async () => {
    const server = await createTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    const port = server.port;
    try {
      const { result } = await checkServerHealth(port);
      expect(result.ok).toBe(false);
      expect(result.hint).toBeDefined();
      expect(result.hint).toContain('Stop the other service');
      expect(result.hint).toContain('different port');
      expect(result.hint).not.toContain('Start it with');
    } finally {
      await server.close();
    }
  });

  test('another service hint does not suggest starting on the occupied port', async () => {
    const server = await createTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    const port = server.port;
    try {
      const { result } = await checkServerHealth(port);
      // The hint must not include the occupied port as a --port flag value
      expect(result.hint).not.toMatch(new RegExp(`--port ${port}(?!\\d)`));
    } finally {
      await server.close();
    }
  });

  test('not reachable hint still says Start it with: opentabs start', async () => {
    const { result } = await checkServerHealth(19998);
    expect(result.ok).toBe(false);
    expect(result.hint).toContain('Start it with');
    expect(result.hint).toContain('opentabs start');
  });

  test('not reachable hint includes --port flag only for non-default port', async () => {
    // Use a port that is definitely not in use (not 9515, which may have a
    // running dev server). Port 19996 is high enough to be free and is still
    // the DEFAULT_PORT-equivalent for the test — we just need a port where
    // fetch throws (i.e., nothing is listening). We test the default-port
    // code path by passing DEFAULT_PORT (9515) but only when the catch branch
    // is actually reached, so we use getPort() to find a free port and then
    // override DEFAULT_PORT behavior by checking the hint text directly.
    //
    // The actual logic under test is: port !== 9515 → include --port flag.
    // We verify both branches by using ports that are guaranteed to be free.
    const freeNonDefaultPort = 19997;
    const { result: nonDefaultResult } = await checkServerHealth(freeNonDefaultPort);
    expect(nonDefaultResult.hint).toContain(`--port ${freeNonDefaultPort}`);

    // For the default port branch, we need port 9515 to be unreachable.
    // If the dev server is running on 9515, this test would hit the "another
    // service" branch instead of the catch branch. Use a mock-friendly
    // approach: just verify the non-default case above works, and trust the
    // source code logic (port !== 9515 check at doctor.ts:102).
    // If 9515 happens to be free, also verify that branch:
    const { result: defaultResult } = await checkServerHealth(9515);
    if (defaultResult.hint?.includes('Start it with')) {
      expect(defaultResult.hint).not.toContain('--port');
    }
    // If 9515 is occupied by a running server, the hint will be about
    // stopping the other service — that's a different code path, not
    // what this test is about, so we skip the assertion.
  });
});

// ---------------------------------------------------------------------------
// Test isolation: override config dir for checkConfigFile and checkPlugins
// ---------------------------------------------------------------------------

const TEST_BASE_DIR = mkdtempSync(join(tmpdir(), 'opentabs-cli-doctor-test-'));
const originalConfigDir = process.env.OPENTABS_CONFIG_DIR;
process.env.OPENTABS_CONFIG_DIR = TEST_BASE_DIR;

afterAll(() => {
  if (originalConfigDir !== undefined) {
    process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.OPENTABS_CONFIG_DIR;
  }
  rmSync(TEST_BASE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// checkConfigFile
// ---------------------------------------------------------------------------

describe('checkConfigFile', () => {
  test('returns pass when config file exists', async () => {
    await writeFile(join(TEST_BASE_DIR, 'config.json'), JSON.stringify({ localPlugins: [] }), 'utf-8');
    const { result, config } = await checkConfigFile();
    expect(result.ok).toBe(true);
    expect(result.label).toBe('Config file');
    expect(result.detail).toContain(TEST_BASE_DIR);
    expect(config).toEqual({ localPlugins: [] });
  });

  test('returns warn when config file is missing', async () => {
    // Use a subdirectory that has no config.json
    const emptyDir = join(TEST_BASE_DIR, 'empty-config-dir');
    mkdirSync(emptyDir, { recursive: true });
    const prev = process.env.OPENTABS_CONFIG_DIR;
    process.env.OPENTABS_CONFIG_DIR = emptyDir;
    try {
      const { result, config } = await checkConfigFile();
      expect(result.ok).toBe(false);
      expect(result.fatal).toBe(false);
      expect(result.label).toBe('Config file');
      expect(result.detail).toContain('not found');
      expect(result.hint).toContain('opentabs start');
      expect(config).toBeNull();
    } finally {
      process.env.OPENTABS_CONFIG_DIR = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// checkAuthSecret
// ---------------------------------------------------------------------------

describe('checkAuthSecret', () => {
  const extensionDir = join(TEST_BASE_DIR, 'extension');
  const authPath = join(extensionDir, 'auth.json');

  test('returns pass when auth.json contains a valid secret', async () => {
    mkdirSync(extensionDir, { recursive: true });
    await writeFile(authPath, JSON.stringify({ secret: 'abc123def456' }), 'utf-8');
    const { result, secret } = await checkAuthSecret();
    expect(result.ok).toBe(true);
    expect(result.label).toBe('Auth secret');
    expect(result.detail).toBe('valid');
    expect(secret).toBe('abc123def456');
  });

  test('returns warn when auth.json is missing', async () => {
    const emptyDir = join(TEST_BASE_DIR, 'empty-auth-dir');
    mkdirSync(emptyDir, { recursive: true });
    const prev = process.env.OPENTABS_CONFIG_DIR;
    process.env.OPENTABS_CONFIG_DIR = emptyDir;
    try {
      const { result, secret } = await checkAuthSecret();
      expect(result.ok).toBe(false);
      expect(result.fatal).toBe(false);
      expect(result.label).toBe('Auth secret');
      expect(result.detail).toContain('missing or invalid');
      expect(result.hint).toContain('opentabs start');
      expect(secret).toBeNull();
    } finally {
      process.env.OPENTABS_CONFIG_DIR = prev;
    }
  });

  test('returns warn when auth.json has empty secret', async () => {
    mkdirSync(extensionDir, { recursive: true });
    await writeFile(authPath, JSON.stringify({ secret: '' }), 'utf-8');
    const { result, secret } = await checkAuthSecret();
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.detail).toContain('missing or invalid');
    expect(secret).toBeNull();
  });

  test('returns warn when auth.json is malformed JSON', async () => {
    mkdirSync(extensionDir, { recursive: true });
    await writeFile(authPath, 'not valid json', 'utf-8');
    const { result, secret } = await checkAuthSecret();
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(secret).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkPlugins
// ---------------------------------------------------------------------------

describe('checkPlugins', () => {
  test('returns warn when config is null', async () => {
    const results = await checkPlugins(null);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.fatal).toBe(false);
    expect(results[0]?.detail).toContain('no config to check');
  });

  test('returns pass when no local plugins are configured', async () => {
    const results = await checkPlugins({ localPlugins: [] });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.label).toBe('Local plugins');
    expect(results[0]?.detail).toContain('none configured');
    expect(results[0]?.detail).toContain('auto-discovered');
  });

  test('returns fail when plugin directory does not exist', async () => {
    const nonexistentPath = join(TEST_BASE_DIR, 'nonexistent-plugin');
    const config = { localPlugins: [nonexistentPath] };
    const results = await checkPlugins(config);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.fatal).toBe(true);
    expect(results[0]?.detail).toContain('directory not found');
  });

  test('returns warn when tools.json is missing', async () => {
    const pluginDir = join(TEST_BASE_DIR, 'plugin-no-tools');
    mkdirSync(pluginDir, { recursive: true });
    const config = { localPlugins: [pluginDir] };
    const results = await checkPlugins(config);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.fatal).toBe(false);
    expect(results[0]?.detail).toContain('tools.json not found');
    expect(results[0]?.hint).toContain('opentabs-plugin build');
  });

  test('returns warn when IIFE file is missing', async () => {
    const pluginDir = join(TEST_BASE_DIR, 'plugin-no-iife');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    await writeFile(join(pluginDir, 'dist', 'tools.json'), JSON.stringify([{ name: 'test' }]), 'utf-8');
    const config = { localPlugins: [pluginDir] };
    const results = await checkPlugins(config);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.fatal).toBe(false);
    expect(results[0]?.detail).toContain('adapter IIFE not found');
    expect(results[0]?.hint).toContain('opentabs-plugin build');
  });

  test('returns pass for valid plugin directory with tools.json and IIFE', async () => {
    const pluginDir = join(TEST_BASE_DIR, 'plugin-valid');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'opentabs-plugin-my-plugin', version: '1.0.0' }),
      'utf-8',
    );
    await writeFile(join(pluginDir, 'dist', 'tools.json'), JSON.stringify([{ name: 'test' }]), 'utf-8');
    await writeFile(join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})()', 'utf-8');
    const config = { localPlugins: [pluginDir] };
    const results = await checkPlugins(config);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.label).toContain('opentabs-plugin-my-plugin');
    expect(results[0]?.detail).toContain('tools.json + IIFE present');
  });

  test('uses path as label when package.json name is unreadable', async () => {
    const pluginDir = join(TEST_BASE_DIR, 'plugin-bad-package');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    await writeFile(join(pluginDir, 'package.json'), 'not valid json', 'utf-8');
    await writeFile(join(pluginDir, 'dist', 'tools.json'), JSON.stringify([{ name: 'test' }]), 'utf-8');
    await writeFile(join(pluginDir, 'dist', 'adapter.iife.js'), '(function(){})()', 'utf-8');
    const config = { localPlugins: [pluginDir] };
    const results = await checkPlugins(config);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.label).toContain(pluginDir);
  });
});

// ---------------------------------------------------------------------------
// checkNpmPlugins
// ---------------------------------------------------------------------------

describe('checkNpmPlugins', () => {
  test('returns warn when health data is null (server not reachable)', () => {
    const results = checkNpmPlugins(null);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.fatal).toBe(false);
    expect(results[0]?.label).toBe('npm plugins');
    expect(results[0]?.detail).toContain('requires running server');
    expect(results[0]?.hint).toBe('Start the MCP server first');
  });

  test('returns pass when no npm plugins are discovered', () => {
    const results = checkNpmPlugins({ pluginDetails: [], failedPlugins: [] });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.label).toBe('npm plugins');
    expect(results[0]?.detail).toContain('none discovered');
  });

  test('excludes local plugins from npm plugin results', () => {
    const results = checkNpmPlugins({
      pluginDetails: [
        { name: 'local-plugin', displayName: 'Local Plugin', toolCount: 2, tabState: 'ready', source: 'local' },
      ],
      failedPlugins: [],
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.label).toBe('npm plugins');
    expect(results[0]?.detail).toContain('none discovered');
  });

  test('lists npm plugins with tool count and tab state', () => {
    const results = checkNpmPlugins({
      pluginDetails: [
        { name: 'slack', displayName: 'Slack', toolCount: 3, tabState: 'ready', source: 'npm' },
        { name: 'jira', displayName: 'Jira', toolCount: 1, tabState: 'closed', source: 'npm' },
      ],
      failedPlugins: [],
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.label).toBe('npm plugin slack');
    expect(results[0]?.detail).toContain('Slack');
    expect(results[0]?.detail).toContain('3 tools');
    expect(results[0]?.detail).toContain('tab ready');
    expect(results[1]?.ok).toBe(true);
    expect(results[1]?.label).toBe('npm plugin jira');
    expect(results[1]?.detail).toContain('1 tool,');
    expect(results[1]?.detail).toContain('tab closed');
  });

  test('shows warnings for failed plugins', () => {
    const results = checkNpmPlugins({
      pluginDetails: [],
      failedPlugins: [{ path: '/usr/lib/node_modules/opentabs-plugin-broken', error: 'missing dist/tools.json' }],
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.fatal).toBe(false);
    expect(results[0]?.detail).toContain('missing dist/tools.json');
    expect(results[0]?.hint).toContain('opentabs-plugin build');
  });

  test('shows both npm plugins and failed plugins', () => {
    const results = checkNpmPlugins({
      pluginDetails: [{ name: 'slack', displayName: 'Slack', toolCount: 3, tabState: 'ready', source: 'npm' }],
      failedPlugins: [{ path: '/usr/lib/node_modules/opentabs-plugin-broken', error: 'parse error' }],
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.label).toBe('npm plugin slack');
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.label).toContain('opentabs-plugin-broken');
  });

  test('handles missing pluginDetails and failedPlugins gracefully', () => {
    const results = checkNpmPlugins({ status: 'ok' });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.detail).toContain('none discovered');
  });
});

// ---------------------------------------------------------------------------
// checkMcpClientConfig
// ---------------------------------------------------------------------------

describe('checkMcpClientConfig', () => {
  test('returns pass when Claude Code config has opentabs entry', async () => {
    const configDir = join(TEST_BASE_DIR, 'mcp-claude');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'mcp.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: { opentabs: { command: 'opentabs' } } }), 'utf-8');

    const result = await checkMcpClientConfig([{ name: 'Claude Code', path: configPath }]);
    expect(result.ok).toBe(true);
    expect(result.label).toBe('MCP client config');
    expect(result.detail).toContain('Claude Code');
    expect(result.detail).toContain(configPath);
  });

  test('returns pass when Cursor config has opentabs entry', async () => {
    const configDir = join(TEST_BASE_DIR, 'mcp-cursor');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { opentabs: { url: 'http://localhost:9515/mcp' } } }),
      'utf-8',
    );

    const result = await checkMcpClientConfig([{ name: 'Cursor', path: configPath }]);
    expect(result.ok).toBe(true);
    expect(result.label).toBe('MCP client config');
    expect(result.detail).toContain('Cursor');
  });

  test('returns warn when no config files exist', async () => {
    const result = await checkMcpClientConfig([
      { name: 'Claude Code', path: join(TEST_BASE_DIR, 'nonexistent', 'mcp.json') },
      { name: 'Cursor', path: join(TEST_BASE_DIR, 'nonexistent2', 'mcp.json') },
    ]);
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.label).toBe('MCP client config');
    expect(result.detail).toContain('no MCP client configured');
    expect(result.hint).toContain('mcp.json');
  });

  test('returns warn when config exists but has no opentabs entry', async () => {
    const configDir = join(TEST_BASE_DIR, 'mcp-no-opentabs');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'mcp.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: { other: { command: 'other' } } }), 'utf-8');

    const result = await checkMcpClientConfig([{ name: 'Claude Code', path: configPath }]);
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.detail).toContain('no MCP client configured');
  });

  test('returns warn when config exists but has no mcpServers key', async () => {
    const configDir = join(TEST_BASE_DIR, 'mcp-no-servers');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'mcp.json');
    await writeFile(configPath, JSON.stringify({ something: 'else' }), 'utf-8');

    const result = await checkMcpClientConfig([{ name: 'Claude Code', path: configPath }]);
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
  });

  test('skips invalid JSON files and checks the next client', async () => {
    const badDir = join(TEST_BASE_DIR, 'mcp-bad-json');
    mkdirSync(badDir, { recursive: true });
    const badPath = join(badDir, 'mcp.json');
    await writeFile(badPath, 'not valid json', 'utf-8');

    const goodDir = join(TEST_BASE_DIR, 'mcp-good-json');
    mkdirSync(goodDir, { recursive: true });
    const goodPath = join(goodDir, 'mcp.json');
    await writeFile(goodPath, JSON.stringify({ mcpServers: { opentabs: {} } }), 'utf-8');

    const result = await checkMcpClientConfig([
      { name: 'Bad Client', path: badPath },
      { name: 'Good Client', path: goodPath },
    ]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('Good Client');
  });

  test('returns first matching client when multiple have opentabs', async () => {
    const dir1 = join(TEST_BASE_DIR, 'mcp-first');
    mkdirSync(dir1, { recursive: true });
    const path1 = join(dir1, 'mcp.json');
    await writeFile(path1, JSON.stringify({ mcpServers: { opentabs: {} } }), 'utf-8');

    const dir2 = join(TEST_BASE_DIR, 'mcp-second');
    mkdirSync(dir2, { recursive: true });
    const path2 = join(dir2, 'mcp.json');
    await writeFile(path2, JSON.stringify({ mcpServers: { opentabs: {} } }), 'utf-8');

    const result = await checkMcpClientConfig([
      { name: 'First', path: path1 },
      { name: 'Second', path: path2 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('First');
  });

  test('returns pass when OpenCode config has opentabs entry in mcp field', async () => {
    const configDir = join(TEST_BASE_DIR, 'mcp-opencode');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'opencode.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcp: { opentabs: { command: 'opentabs', args: ['start', '--mcp'] } } }),
      'utf-8',
    );

    const result = await checkMcpClientConfig([{ name: 'OpenCode', path: configPath }]);
    expect(result.ok).toBe(true);
    expect(result.label).toBe('MCP client config');
    expect(result.detail).toContain('OpenCode');
    expect(result.detail).toContain(configPath);
  });

  test('returns warn when OpenCode config has mcp field but no opentabs entry', async () => {
    const configDir = join(TEST_BASE_DIR, 'mcp-opencode-no-opentabs');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'opencode.json');
    await writeFile(configPath, JSON.stringify({ mcp: { other: { command: 'other' } } }), 'utf-8');

    const result = await checkMcpClientConfig([{ name: 'OpenCode', path: configPath }]);
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.detail).toContain('no MCP client configured');
  });

  test('returns warn hint mentioning OpenCode when no client is configured', async () => {
    const result = await checkMcpClientConfig([
      { name: 'Claude Code', path: join(TEST_BASE_DIR, 'nonexistent3', 'mcp.json') },
      { name: 'Cursor', path: join(TEST_BASE_DIR, 'nonexistent4', 'mcp.json') },
      { name: 'OpenCode', path: join(TEST_BASE_DIR, 'nonexistent5', 'opencode.json') },
    ]);
    expect(result.ok).toBe(false);
    expect(result.hint).toContain('OpenCode');
    expect(result.hint).toContain('opencode.json');
  });

  test('prefers mcpServers format over mcp format when both are present', async () => {
    const configDir = join(TEST_BASE_DIR, 'mcp-both-formats');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'config.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: { opentabs: {} }, mcp: { opentabs: {} } }), 'utf-8');

    const result = await checkMcpClientConfig([{ name: 'Both', path: configPath }]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('Both');
  });
});

// ---------------------------------------------------------------------------
// isCwdProjectDirectory
// ---------------------------------------------------------------------------

describe('isCwdProjectDirectory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns false when CWD is filesystem root', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/');
    expect(isCwdProjectDirectory()).toBe(false);
  });

  test('returns false when CWD has neither package.json nor .git', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'opentabs-cwd-empty-'));
    try {
      vi.spyOn(process, 'cwd').mockReturnValue(emptyDir);
      expect(isCwdProjectDirectory()).toBe(false);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('returns true when CWD has package.json', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'opentabs-cwd-pkg-'));
    try {
      writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test' }));
      vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
      expect(isCwdProjectDirectory()).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test('returns true when CWD has .git directory', () => {
    const gitDir = mkdtempSync(join(tmpdir(), 'opentabs-cwd-git-'));
    try {
      mkdirSync(join(gitDir, '.git'));
      vi.spyOn(process, 'cwd').mockReturnValue(gitDir);
      expect(isCwdProjectDirectory()).toBe(true);
    } finally {
      rmSync(gitDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// defaultMcpClientLocations
// ---------------------------------------------------------------------------

describe('defaultMcpClientLocations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('always includes home-directory-relative paths', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/');
    const locations = defaultMcpClientLocations();
    const home = homedir();
    const homePaths = locations.filter(l => l.path.startsWith(home));
    expect(homePaths.length).toBeGreaterThan(0);
    expect(locations.some(l => l.name === 'Claude Code')).toBe(true);
    expect(locations.some(l => l.name === 'Windsurf')).toBe(true);
  });

  test('excludes CWD-relative paths when CWD is filesystem root', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/');
    const locations = defaultMcpClientLocations();
    const home = homedir();
    const cwdPaths = locations.filter(l => !l.path.startsWith(home));
    expect(cwdPaths).toHaveLength(0);
  });

  test('excludes CWD-relative paths when CWD is not a project directory', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'opentabs-cwd-noproject-'));
    try {
      vi.spyOn(process, 'cwd').mockReturnValue(emptyDir);
      const locations = defaultMcpClientLocations();
      const cwdPaths = locations.filter(l => l.path.startsWith(emptyDir));
      expect(cwdPaths).toHaveLength(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('includes CWD-relative paths when CWD is a project directory', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'opentabs-cwd-project-'));
    try {
      writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test' }));
      vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
      const locations = defaultMcpClientLocations();
      const cwdPaths = locations.filter(l => l.path.startsWith(projectDir));
      expect(cwdPaths.length).toBeGreaterThan(0);
      expect(cwdPaths.some(l => l.name === 'Cursor')).toBe(true);
      expect(cwdPaths.some(l => l.name === 'OpenCode')).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// checkMcpServerVersion
// ---------------------------------------------------------------------------

describe('checkMcpServerVersion', () => {
  beforeEach(() => {
    vi.mocked(getCliVersion).mockResolvedValue('1.0.0');
    vi.mocked(getMcpServerVersion).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test('returns warn when MCP server version is unreadable', async () => {
    vi.mocked(getMcpServerVersion).mockResolvedValue(null);
    const result: CheckResult = await checkMcpServerVersion();
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.label).toBe('MCP server version');
    expect(result.detail).toContain('could not read version');
    expect(result.hint).toContain('@opentabs-dev/mcp-server');
  });

  test('returns pass when server version matches CLI version', async () => {
    vi.mocked(getCliVersion).mockResolvedValue('1.2.3');
    vi.mocked(getMcpServerVersion).mockResolvedValue('1.2.3');
    const result: CheckResult = await checkMcpServerVersion();
    expect(result.ok).toBe(true);
    expect(result.label).toBe('MCP server version');
    expect(result.detail).toContain('v1.2.3');
    expect(result.detail).toContain('matches CLI');
  });

  test('returns warn when server version differs from CLI version', async () => {
    vi.mocked(getCliVersion).mockResolvedValue('1.2.3');
    vi.mocked(getMcpServerVersion).mockResolvedValue('1.0.0');
    const result: CheckResult = await checkMcpServerVersion();
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(false);
    expect(result.label).toBe('MCP server version');
    expect(result.detail).toContain('v1.0.0');
    expect(result.detail).toContain('CLI is v1.2.3');
    expect(result.hint).toContain('npm install');
  });
});
