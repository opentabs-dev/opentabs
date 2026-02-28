/**
 * E2E tests for MCP resources and prompts.
 *
 * Tests the full dispatch pipeline for resources/list, resources/read,
 * prompts/list, and prompts/get — from MCP client through the MCP server,
 * WebSocket, Chrome extension, and injected adapter running in page context.
 *
 * The e2e-test plugin defines:
 *   - A test resource: URI 'test://items', returns JSON list of items
 *   - A test prompt: name 'greet', takes a 'name' argument, returns a greeting
 *
 * Prerequisites:
 *   - `npm run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built with resource/prompt support
 *   - Chromium is installed for Playwright
 */

import {
  test,
  expect,
  startMcpServer,
  createMcpClient,
  createMinimalPlugin,
  cleanupTestConfigDir,
  writeTestConfig,
} from './fixtures.js';
import { setupToolTest } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpClient, McpServer } from './fixtures.js';

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

test.describe('Resources — full stack', () => {
  test('list resources includes the test resource with correct prefixed URI', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const resources = await mcpClient.listResources();
    const testResource = resources.find(r => r.name === 'Test Items');

    expect(testResource).toBeDefined();
    if (!testResource) throw new Error('Test resource not found');
    expect(testResource.uri).toBe('opentabs+e2e-test://test://items');
    expect(testResource.description).toBe('Returns the list of items from the test server page');
    expect(testResource.mimeType).toBe('application/json');
  });

  test('read resource returns expected JSON data from the test server', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const contents = await mcpClient.readResource('opentabs+e2e-test://test://items');

    expect(contents.length).toBeGreaterThanOrEqual(1);
    const content = contents[0];
    if (!content) throw new Error('No content returned');
    expect(content.uri).toBe('opentabs+e2e-test://test://items');
    expect(content.mimeType).toBe('application/json');
    expect(content.text).toBeDefined();

    const parsed = JSON.parse(content.text as string) as { items: Array<{ id: string; name: string }>; total: number };
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(typeof parsed.total).toBe('number');
  });

  test('read resource with nonexistent URI returns an error', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    await expect(mcpClient.readResource('opentabs+e2e-test://nonexistent://resource')).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

test.describe('Prompts — full stack', () => {
  test('list prompts includes the test prompt with correct prefixed name', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const prompts = await mcpClient.listPrompts();
    const testPrompt = prompts.find(p => p.name === 'e2e-test_greet');

    expect(testPrompt).toBeDefined();
    if (!testPrompt) throw new Error('Test prompt not found');
    expect(testPrompt.description).toBe('Generates a greeting message');
    expect(testPrompt.arguments).toBeDefined();
    expect(testPrompt.arguments?.length).toBe(1);
    const arg = testPrompt.arguments?.[0];
    expect(arg?.name).toBe('name');
    expect(arg?.description).toBe('The name to greet');
    expect(arg?.required).toBe(true);
  });

  test('get prompt returns expected greeting messages', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const messages = await mcpClient.getPrompt('e2e-test_greet', { name: 'World' });

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages[0];
    if (!msg) throw new Error('No message returned');
    expect(msg.role).toBe('user');
    expect(msg.content.type).toBe('text');
    expect(msg.content.text).toBe('Hello, World!');
  });

  test('get prompt with nonexistent name returns an error', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    await expect(mcpClient.getPrompt('nonexistent_prompt')).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Typed prompts (Zod args schema)
// ---------------------------------------------------------------------------

test.describe('Typed prompts — Zod args schema', () => {
  test('list prompts returns argument metadata derived from Zod schema', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const prompts = await mcpClient.listPrompts();
    const typedPrompt = prompts.find(p => p.name === 'e2e-test_typed_greet');

    expect(typedPrompt).toBeDefined();
    if (!typedPrompt) throw new Error('Typed prompt not found');
    expect(typedPrompt.description).toBe('A typed greeting prompt with Zod args schema');
    expect(typedPrompt.arguments).toBeDefined();
    expect(typedPrompt.arguments?.length).toBe(2);

    const nameArg = typedPrompt.arguments?.find(a => a.name === 'name');
    expect(nameArg).toBeDefined();
    expect(nameArg?.description).toBe('Name to greet');
    expect(nameArg?.required).toBe(true);

    const formalArg = typedPrompt.arguments?.find(a => a.name === 'formal');
    expect(formalArg).toBeDefined();
    expect(formalArg?.description).toBe('Whether to use formal greeting');
    expect(formalArg?.required).toBe(false);
  });

  test('get typed prompt returns informal greeting by default', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const messages = await mcpClient.getPrompt('e2e-test_typed_greet', { name: 'Alice' });

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages[0];
    if (!msg) throw new Error('No message returned');
    expect(msg.role).toBe('user');
    expect(msg.content.type).toBe('text');
    expect(msg.content.text).toBe('Hey Alice!');
  });

  test('get typed prompt returns formal greeting when formal arg is set', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const messages = await mcpClient.getPrompt('e2e-test_typed_greet', {
      name: 'Bob',
      formal: 'true',
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages[0];
    if (!msg) throw new Error('No message returned');
    expect(msg.role).toBe('user');
    expect(msg.content.type).toBe('text');
    expect(msg.content.text).toBe('Dear Bob!');
  });

  test('get typed prompt with missing required argument renders with undefined value', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // The typed_greet prompt requires 'name' but we omit it. The MCP server
    // does not validate individual prompt arguments — they pass through to
    // the adapter, which renders with the missing value as undefined.
    const messages = await mcpClient.getPrompt('e2e-test_typed_greet', {});

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages[0];
    if (!msg) throw new Error('No message returned');
    expect(msg.role).toBe('user');
    expect(msg.content.type).toBe('text');
    // The render function uses args.name directly — with no name, it produces "Hey undefined!"
    expect(msg.content.text).toContain('undefined');
  });
});

// ---------------------------------------------------------------------------
// Empty resource/prompt lists — standalone server with no plugin resources/prompts
// ---------------------------------------------------------------------------

test.describe('Empty resource/prompt lists', () => {
  test('resource list returns empty array when no plugins define resources', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-rp-nores-'));

    // Create a minimal plugin that defines tools but no resources or prompts
    const pluginDir = createMinimalPlugin(tmpDir, 'no-resources', [{ name: 'ping', description: 'A ping tool' }]);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-rp-nores-cfg-'));
    writeTestConfig(configDir, {
      localPlugins: [pluginDir],
      tools: { 'no-resources_ping': true },
    });

    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();
      await server.waitForHealth(h => h.status === 'ok');

      const resources = await client.listResources();
      expect(resources).toHaveLength(0);
    } finally {
      await client?.close();
      await server?.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('prompt list returns empty array when no plugins define prompts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-rp-noprompts-'));

    // Create a minimal plugin that defines tools but no resources or prompts
    const pluginDir = createMinimalPlugin(tmpDir, 'no-prompts', [{ name: 'ping', description: 'A ping tool' }]);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-rp-noprompts-cfg-'));
    writeTestConfig(configDir, {
      localPlugins: [pluginDir],
      tools: { 'no-prompts_ping': true },
    });

    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();
      await server.waitForHealth(h => h.status === 'ok');

      const prompts = await client.listPrompts();
      expect(prompts).toHaveLength(0);
    } finally {
      await client?.close();
      await server?.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
