import { createToolRegistrar, withToolId } from '@opentabs/plugin-sdk/server';
import type { ToolResult, ToolResultContent } from '@opentabs/plugin-sdk/server';

// ---------------------------------------------------------------------------
// ParsedToolResult — ergonomic wrapper for tool invocation results
// ---------------------------------------------------------------------------

interface ParsedToolResult {
  /** Raw tool result object */
  readonly raw: ToolResult;
  /** Whether the tool returned an error */
  readonly isError: boolean;
  /** The text content of the first text block */
  readonly text: string;
  /** Parsed data from the first text block (if JSON) */
  readonly data: unknown;
  /** Parse the first text block as typed JSON */
  readonly json: <T>() => T;
}

const parsedToolResult = (raw: ToolResult): ParsedToolResult => {
  const firstContent: ToolResultContent | undefined = raw.content[0];
  const text = firstContent?.type === 'text' ? firstContent.text : '';
  let cachedData: unknown;
  let dataParsed = false;

  const parseData = (): unknown => {
    if (!dataParsed) {
      try {
        cachedData = JSON.parse(text);
      } catch {
        cachedData = undefined;
      }
      dataParsed = true;
    }
    return cachedData;
  };

  return {
    raw,
    isError: raw.isError === true,
    text,
    get data() {
      return parseData();
    },
    json: <T>() => parseData() as T,
  };
};

// ---------------------------------------------------------------------------
// FakeMcpServer — minimal McpServerLike implementation for tests
// ---------------------------------------------------------------------------

interface StoredToolDefinition {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly handler: (...args: readonly unknown[]) => Promise<ToolResult>;
}

const createFakeMcpServer = () => {
  const registeredTools = new Map<string, StoredToolDefinition>();

  const tool = (...args: readonly unknown[]): void => {
    const name = args[0] as string;
    const handlerIndex = args.length - 1;
    const handler = args[handlerIndex] as (...a: readonly unknown[]) => Promise<ToolResult>;
    registeredTools.set(name, { name, args: [...args], handler });
  };

  return { tool, registeredTools };
};

// ---------------------------------------------------------------------------
// TestHarness — createTestHarness()
// ---------------------------------------------------------------------------

interface TestHarness {
  /** Register tools by calling the plugin's registerTools function */
  readonly registerTools: (
    registerFn: (
      server: { readonly tool: (...args: readonly unknown[]) => void },
      registrar: ReturnType<typeof createToolRegistrar>,
    ) => void,
  ) => void;
  /** Call a registered tool by name with the given params */
  readonly callTool: (name: string, params?: Record<string, unknown>) => Promise<ParsedToolResult>;
  /** Get the names of all registered tools */
  readonly toolNames: readonly string[];
  /** Get a registered tool definition by name */
  readonly getTool: (name: string) => StoredToolDefinition | undefined;
  /** Assert that a tool is registered (throws if not) */
  readonly assertToolRegistered: (name: string) => void;
}

/**
 * Create a test harness for unit-testing plugin tool handlers
 * without a running MCP server or browser extension.
 */
const createTestHarness = (): TestHarness => {
  const fakeMcpServer = createFakeMcpServer();
  const registrar = createToolRegistrar(fakeMcpServer);

  const registerTools: TestHarness['registerTools'] = registerFn => {
    registerFn(fakeMcpServer, registrar);
  };

  const callTool = async (name: string, params?: Record<string, unknown>): Promise<ParsedToolResult> => {
    const toolDef = fakeMcpServer.registeredTools.get(name);
    if (toolDef === undefined) {
      throw new Error(
        `Tool "${name}" is not registered. Available tools: ${[...fakeMcpServer.registeredTools.keys()].join(', ')}`,
      );
    }
    const result = await withToolId(name, () => toolDef.handler({ params: params ?? {} }));
    return parsedToolResult(result);
  };

  return {
    registerTools,
    callTool,
    get toolNames() {
      return [...fakeMcpServer.registeredTools.keys()];
    },
    getTool: (name: string) => fakeMcpServer.registeredTools.get(name),
    assertToolRegistered: (name: string) => {
      if (!fakeMcpServer.registeredTools.has(name)) {
        throw new Error(
          `Expected tool "${name}" to be registered, but it was not. Available tools: ${[...fakeMcpServer.registeredTools.keys()].join(', ')}`,
        );
      }
    },
  };
};

export { createTestHarness, parsedToolResult, type TestHarness, type ParsedToolResult, type StoredToolDefinition };
