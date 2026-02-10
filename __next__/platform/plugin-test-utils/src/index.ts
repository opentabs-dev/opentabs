// =============================================================================
// @opentabs/plugin-test-utils — Barrel Export
//
// Testing utilities for OpenTabs plugin authors. Provides mock providers,
// test harnesses, and assertion helpers that enable testing plugin tools
// without a running MCP server, Chrome extension, or browser tabs.
//
// This package is the recommended way to write tests for OpenTabs plugins.
// It handles the SDK's dependency injection (request provider), simulates
// the MCP server's tool registration pipeline, and provides ergonomic
// assertion methods for verifying tool behavior.
//
// Quick start:
//
//   import { createMockProvider, createTestHarness } from '@opentabs/plugin-test-utils';
//   import { registerTools } from '../src/tools/index.js';
//
//   const mock = createMockProvider();
//   mock.install();
//
//   const harness = createTestHarness();
//   harness.registerTools(registerTools);
//
//   mock.onServiceRequest('my-service', { endpoint: '/api/items' }).resolveWith([{ id: 1 }]);
//
//   const result = await harness.callTool('myservice_list_items', { limit: 10 });
//   expect(result.isError).toBe(false);
//   expect(result.json()).toEqual([{ id: 1 }]);
//
//   mock.uninstall();
//
// =============================================================================

// -----------------------------------------------------------------------------
// Mock Request Provider — Stub adapter and browser responses
// -----------------------------------------------------------------------------

export { createMockProvider } from './mock-provider.js';

export type {
  MockProvider,
  ServiceStubBuilder,
  BrowserStubBuilder,
  ServiceRequestCall,
  BrowserRequestCall,
  ReloadExtensionCall,
  RecordedCall,
} from './mock-provider.js';

// -----------------------------------------------------------------------------
// Test Harness — Register and invoke tool handlers
// -----------------------------------------------------------------------------

export { createTestHarness } from './test-harness.js';

export type { TestHarness, RegisteredTestTool, ParsedToolResult, ToolResult } from './test-harness.js';
