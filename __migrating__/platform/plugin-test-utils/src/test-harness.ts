// =============================================================================
// Test Harness — Run Plugin Tool Handlers in Isolation
//
// Provides a lightweight test harness that simulates the MCP server's tool
// registration and invocation pipeline. Plugin authors can register their
// tools, invoke them by name with typed parameters, and inspect the results
// without a running MCP server, Chrome extension, or AI client.
//
// The harness wraps the plugin's registerTools function, collects all
// registered tools, and provides a `callTool(name, params)` method that
// invokes the tool handler with proper AsyncLocalStorage context (so that
// getCurrentToolId() works correctly in nested calls).
//
// Usage:
//
//   import { createTestHarness } from '@opentabs/plugin-test-utils';
//   import { registerTools } from '../src/tools/index.js';
//
//   const harness = createTestHarness();
//   harness.registerTools(registerTools);
//
//   const result = await harness.callTool('slack_search_messages', {
//     query: 'from:@alice in:#general',
//     count: 5,
//   });
//
//   expect(result.isError).toBeFalsy();
//   expect(result.content[0].text).toContain('matches');
//
// =============================================================================

import { withToolId } from '@opentabs/plugin-sdk/server';

// =============================================================================
// Types
// =============================================================================

/** The shape returned by every MCP tool handler (matches the SDK's ToolResult). */
interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Parsed tool result with convenience accessors. */
interface ParsedToolResult {
  /** The raw tool result as returned by the handler. */
  readonly raw: ToolResult;

  /** Whether the tool reported an error. */
  readonly isError: boolean;

  /** The text content of the first content block. */
  readonly text: string;

  /**
   * The parsed JSON data from the first content block.
   * Returns undefined if the content is not valid JSON.
   */
  readonly data: unknown;

  /**
   * Typed accessor for the parsed data. Throws if data is undefined.
   */
  json<T = unknown>(): T;
}

/**
 * Metadata about a registered tool, extracted from the MCP server's
 * registerTool call.
 */
interface RegisteredTestTool {
  /** The tool name (e.g. 'slack_send_message'). */
  readonly name: string;
  /** The tool's description. */
  readonly description?: string;
  /** The tool's input schema (Zod shape, opaque here). */
  readonly inputSchema?: unknown;
  /** The tool's annotations. */
  readonly annotations?: Record<string, unknown>;
  /** The raw handler function. */
  readonly handler: (...args: unknown[]) => Promise<unknown>;
}

/**
 * The test harness instance with tool registration, invocation, and
 * introspection methods.
 */
interface TestHarness {
  /**
   * Register tools using a plugin's registerTools function.
   * Can be called multiple times to register tools from multiple modules.
   *
   * @param registerFn - The plugin's registerTools function
   */
  registerTools(registerFn: (server: unknown) => Map<string, unknown>): void;

  /**
   * Call a registered tool by name with the given parameters.
   * Runs the handler inside a withToolId context so getCurrentToolId() works.
   *
   * @param name - The tool name (e.g. 'slack_send_message')
   * @param params - The input parameters matching the tool's schema
   * @returns The parsed tool result
   * @throws Error if the tool is not registered
   */
  callTool(name: string, params?: Record<string, unknown>): Promise<ParsedToolResult>;

  /**
   * Get all registered tool names.
   */
  readonly toolNames: readonly string[];

  /**
   * Get metadata about a specific registered tool.
   *
   * @param name - The tool name
   * @returns The tool metadata, or undefined if not registered
   */
  getTool(name: string): RegisteredTestTool | undefined;

  /**
   * Check whether a tool is registered.
   *
   * @param name - The tool name
   */
  hasTool(name: string): boolean;

  /**
   * Remove all registered tools. Useful between test suites.
   */
  reset(): void;

  /**
   * Assert that a tool with the given name is registered.
   * Throws with a descriptive message if not found.
   */
  assertToolRegistered(name: string): void;

  /**
   * Assert that a set of tool names are all registered.
   * Throws with a descriptive message listing which are missing.
   */
  assertToolsRegistered(names: readonly string[]): void;
}

// =============================================================================
// Mock McpServer
//
// A lightweight stand-in for @modelcontextprotocol/sdk's McpServer that
// captures tool registrations without requiring the actual MCP SDK.
// The harness passes this to the plugin's registerTools function.
// =============================================================================

/**
 * A RegisteredTool-like object returned by the mock server's registerTool.
 * Satisfies the RegisteredToolLike interface from @opentabs/core.
 */
interface MockRegisteredTool {
  enabled: boolean;
  update: (config: Record<string, unknown>) => void;
  remove: () => void;
}

/**
 * Create a mock MCP server that captures tool registrations.
 *
 * The mock mimics the McpServer.registerTool API:
 *   server.registerTool(name, config, handler) => RegisteredTool
 *
 * It stores all registrations for later retrieval by the test harness.
 */
const createMockServer = (): {
  server: { registerTool: (...args: unknown[]) => MockRegisteredTool };
  registrations: Map<string, RegisteredTestTool>;
} => {
  const registrations = new Map<string, RegisteredTestTool>();

  const server = {
    registerTool: (...args: unknown[]): MockRegisteredTool => {
      // McpServer.registerTool is called as:
      //   registerTool(name, config, handler)
      // where config has { description, inputSchema, annotations, title }
      const name = args[0] as string;
      const config = (args[1] ?? {}) as Record<string, unknown>;
      const handler = args[2] as (...a: unknown[]) => Promise<unknown>;

      registrations.set(name, {
        name,
        description: config.description as string | undefined,
        inputSchema: config.inputSchema,
        annotations: config.annotations as Record<string, unknown> | undefined,
        handler,
      });

      // Return a mock RegisteredTool
      const mockTool: MockRegisteredTool = {
        enabled: true,
        update: () => {},
        remove: () => {
          registrations.delete(name);
          mockTool.enabled = false;
        },
      };

      return mockTool;
    },
  };

  return { server, registrations };
};

// =============================================================================
// Result Parsing
// =============================================================================

/**
 * Wrap a raw tool result in a ParsedToolResult with convenience accessors.
 */
const parseToolResult = (raw: unknown): ParsedToolResult => {
  const result = raw as ToolResult;

  const text = result.content?.[0]?.text ?? '';

  let parsedData: unknown;
  let dataParsed = false;

  // Lazily parse JSON from the text content
  const getData = (): unknown => {
    if (!dataParsed) {
      dataParsed = true;
      try {
        parsedData = JSON.parse(text);
      } catch {
        parsedData = undefined;
      }
    }
    return parsedData;
  };

  return {
    raw: result,
    isError: result.isError === true,
    text,
    get data(): unknown {
      return getData();
    },
    json<T = unknown>(): T {
      const d = getData();
      if (d === undefined) {
        throw new Error(
          `Tool result content is not valid JSON.\nRaw text: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}`,
        );
      }
      return d as T;
    },
  };
};

// =============================================================================
// Harness Factory
// =============================================================================

/**
 * Create a new test harness for running plugin tool handlers in isolation.
 *
 * @returns A TestHarness instance
 *
 * @example
 * ```ts
 * import { createTestHarness, createMockProvider } from '@opentabs/plugin-test-utils';
 * import { registerTools } from '@opentabs/plugin-slack';
 *
 * // Set up mock provider for adapter communication
 * const mock = createMockProvider();
 * mock.install();
 *
 * // Set up test harness for tool invocation
 * const harness = createTestHarness();
 * harness.registerTools(registerTools);
 *
 * // Stub the adapter response
 * mock.onServiceRequest('slack', { method: 'search.messages' }).resolveWith({
 *   ok: true,
 *   messages: { matches: [{ text: 'hello', ts: '123', channel: { id: 'C1', name: 'general' } }], total: 1, paging: { count: 1, total: 1, page: 1, pages: 1 } },
 * });
 *
 * // Call the tool
 * const result = await harness.callTool('slack_search_messages', { query: 'hello' });
 *
 * // Assert on the result
 * expect(result.isError).toBe(false);
 * const data = result.json<{ matches: unknown[]; total: number }>();
 * expect(data.total).toBe(1);
 *
 * // Clean up
 * mock.uninstall();
 * harness.reset();
 * ```
 */
const createTestHarness = (): TestHarness => {
  const tools = new Map<string, RegisteredTestTool>();

  const harness: TestHarness = {
    registerTools(registerFn: (server: unknown) => Map<string, unknown>): void {
      const { server, registrations } = createMockServer();

      // Call the plugin's registerTools function with our mock server.
      // The plugin-sdk's createToolRegistrar wraps handlers with withToolId
      // and try/catch, so the handlers stored in registrations are already
      // wrapped. We don't need to re-wrap them.
      registerFn(server);

      // Merge new registrations into the harness
      for (const [name, tool] of registrations) {
        if (tools.has(name)) {
          throw new Error(
            `Tool name collision in test harness: "${name}" is already registered. ` +
              `Each tool must have a unique name.`,
          );
        }
        tools.set(name, tool);
      }
    },

    async callTool(name: string, params?: Record<string, unknown>): Promise<ParsedToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        const available = [...tools.keys()].sort().join(', ');
        throw new Error(
          `Tool "${name}" is not registered in the test harness.\nAvailable tools: ${available || '(none)'}`,
        );
      }

      // The mock registerTool captured the already-wrapped handler (including
      // withToolId and try/catch from defineTool). Wrap in withToolId as a
      // safety net for raw handlers tested directly.
      const raw = await withToolId(name, async () => tool.handler(params ?? {}));
      return parseToolResult(raw);
    },

    get toolNames(): readonly string[] {
      return [...tools.keys()].sort();
    },

    getTool(name: string): RegisteredTestTool | undefined {
      return tools.get(name);
    },

    hasTool(name: string): boolean {
      return tools.has(name);
    },

    reset(): void {
      tools.clear();
    },

    assertToolRegistered(name: string): void {
      if (!tools.has(name)) {
        const available = [...tools.keys()].sort().join(', ');
        throw new Error(
          `Expected tool "${name}" to be registered, but it was not.\nRegistered tools: ${available || '(none)'}`,
        );
      }
    },

    assertToolsRegistered(names: readonly string[]): void {
      const missing = names.filter(n => !tools.has(n));
      if (missing.length > 0) {
        const available = [...tools.keys()].sort().join(', ');
        throw new Error(
          `Expected ${names.length} tools to be registered, but ${missing.length} are missing:\n` +
            `  Missing: ${missing.join(', ')}\n` +
            `  Registered: ${available || '(none)'}`,
        );
      }
    },
  };

  return harness;
};

export type { TestHarness, RegisteredTestTool, ParsedToolResult, ToolResult };

export { createTestHarness };
