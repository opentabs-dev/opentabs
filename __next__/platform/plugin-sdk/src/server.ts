import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpServerLike, NativeApiPermission } from '@opentabs/core';

// ---------------------------------------------------------------------------
// AsyncLocalStorage — tracks the current tool ID per request
// ---------------------------------------------------------------------------

const toolIdStorage = new AsyncLocalStorage<string>();

/** Run a callback with a tool ID in the async context */
const withToolId = <T>(toolId: string, fn: () => T): T => toolIdStorage.run(toolId, fn);

/** Get the current tool ID from the async context */
const getCurrentToolId = (): string | undefined => toolIdStorage.getStore();

// ---------------------------------------------------------------------------
// RequestProvider — pluggable transport for service/browser requests
// ---------------------------------------------------------------------------

interface RequestProvider {
  readonly sendServiceRequest: (service: string, params: Record<string, unknown>, action?: string) => Promise<unknown>;
  readonly sendBrowserRequest: (action: string, params?: Record<string, unknown>) => Promise<unknown>;
  readonly reloadExtension: () => Promise<void>;
}

let requestProvider: RequestProvider | undefined;

/** Internal API for the MCP server to wire the request provider */
const __setRequestProvider = (provider: RequestProvider): void => {
  requestProvider = provider;
};

// ---------------------------------------------------------------------------
// Plugin Permissions — runtime permission enforcement
// ---------------------------------------------------------------------------

/** Map from plugin name to set of native API permissions */
const pluginPermissions = new Map<string, ReadonlySet<NativeApiPermission>>();

/** Map from tool ID to plugin name for reverse lookup */
const toolToPlugin = new Map<string, string>();

/** Internal API for the MCP server to register plugin permissions and tool-to-plugin mappings */
const __registerPluginPermissions = (
  pluginName: string,
  permissions: readonly NativeApiPermission[],
  toolIds: readonly string[],
): void => {
  pluginPermissions.set(pluginName, new Set(permissions));
  for (const toolId of toolIds) {
    toolToPlugin.set(toolId, pluginName);
  }
};

const getPluginForCurrentTool = (): string | undefined => {
  const toolId = getCurrentToolId();
  if (toolId === undefined) return undefined;
  return toolToPlugin.get(toolId);
};

const hasNativeApiPermission = (permission: NativeApiPermission): boolean => {
  const pluginName = getPluginForCurrentTool();
  if (pluginName === undefined) return true;
  const perms = pluginPermissions.get(pluginName);
  if (perms === undefined) return false;
  return perms.has(permission);
};

// ---------------------------------------------------------------------------
// Service / Browser Request Functions
// ---------------------------------------------------------------------------

/**
 * Send a request to a webapp service through the extension.
 * Delegates to the wired RequestProvider.
 */
const sendServiceRequest = (service: string, params: Record<string, unknown>, action?: string): Promise<unknown> => {
  if (requestProvider === undefined) {
    return Promise.reject(new Error('RequestProvider not configured — is the MCP server running?'));
  }
  return requestProvider.sendServiceRequest(service, params, action);
};

/**
 * Send a request to the browser via chrome.* APIs through the extension.
 * Gated by the 'browser' nativeApis permission — rejected at runtime if the
 * plugin doesn't declare 'browser' in its permissions.nativeApis.
 */
const sendBrowserRequest = (action: string, params?: Record<string, unknown>): Promise<unknown> => {
  if (!hasNativeApiPermission('browser')) {
    const pluginName = getPluginForCurrentTool() ?? 'unknown';
    return Promise.reject(
      new Error(
        `Plugin "${pluginName}" does not have 'browser' nativeApi permission. ` +
          `Add 'browser' to permissions.nativeApis in your opentabs-plugin.json manifest.`,
      ),
    );
  }
  if (requestProvider === undefined) {
    return Promise.reject(new Error('RequestProvider not configured — is the MCP server running?'));
  }
  return requestProvider.sendBrowserRequest(action, params);
};

// ---------------------------------------------------------------------------
// Tool Result Helpers
// ---------------------------------------------------------------------------

interface ToolResultContent {
  readonly type: 'text';
  readonly text: string;
}

interface ToolResult {
  readonly content: readonly ToolResultContent[];
  readonly isError?: boolean;
}

/** Format a successful tool result per the MCP protocol */
const success = (data: unknown): ToolResult => {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
};

/** Format an error tool result per the MCP protocol */
const error = (err: unknown): ToolResult => {
  const message = err instanceof Error ? err.message : String(err);

  for (const pattern of errorPatterns) {
    if (pattern.test(message)) {
      return { content: [{ type: 'text', text: pattern.format(message) }], isError: true };
    }
  }

  return { content: [{ type: 'text', text: message }], isError: true };
};

// ---------------------------------------------------------------------------
// Error Pattern Registry — extensible patterns for common API errors
// ---------------------------------------------------------------------------

interface ErrorPattern {
  /** Test whether this pattern matches the error message */
  readonly test: (message: string) => boolean;
  /** Format the error message for the tool result */
  readonly format: (message: string) => string;
}

const errorPatterns: ErrorPattern[] = [];

/** Register an error pattern for formatting common API errors */
const registerErrorPattern = (pattern: ErrorPattern): void => {
  errorPatterns.push(pattern);
};

// ---------------------------------------------------------------------------
// Tool Registrar — createToolRegistrar
// ---------------------------------------------------------------------------

interface RegisteredTool {
  readonly name: string;
  readonly handler: (...args: readonly unknown[]) => Promise<ToolResult>;
}

interface ToolRegistrar {
  /** Map of registered tool names to their definitions */
  readonly tools: Map<string, RegisteredTool>;
  /**
   * Define a tool. Wraps the handler to run within the tool's async context.
   * Signature mirrors server.tool() from @modelcontextprotocol/sdk but captures
   * the registration for hot-reload diffing.
   */
  readonly define: (...args: readonly unknown[]) => void;
}

/**
 * Create a tool registrar bound to an MCP server instance.
 * The registrar's `define` method delegates to `server.tool()` and
 * also captures the tool in its local `tools` map for hot-reload tracking.
 */
const createToolRegistrar = (server: McpServerLike): ToolRegistrar => {
  const tools = new Map<string, RegisteredTool>();

  const define = (...args: readonly unknown[]): void => {
    const name = args[0] as string;

    /* Find the handler — it's the last function argument.
       server.tool() signatures:
         (name, handler)
         (name, description, handler)
         (name, schema, handler)
         (name, description, schema, handler) */
    const handlerIndex = args.length - 1;
    const originalHandler = args[handlerIndex] as (...a: readonly unknown[]) => Promise<ToolResult>;

    const wrappedHandler = (...handlerArgs: readonly unknown[]): Promise<ToolResult> =>
      withToolId(name, () => originalHandler(...handlerArgs));

    const wrappedArgs = [...args];
    wrappedArgs[handlerIndex] = wrappedHandler;

    tools.set(name, { name, handler: wrappedHandler });

    server.tool(...wrappedArgs);
  };

  return { tools, define };
};

// ---------------------------------------------------------------------------
// Exports (all at bottom per ESLint exports-last rule)
// ---------------------------------------------------------------------------

export {
  createToolRegistrar,
  sendServiceRequest,
  sendBrowserRequest,
  __setRequestProvider,
  __registerPluginPermissions,
  withToolId,
  getCurrentToolId,
  success,
  error,
  registerErrorPattern,
  type RequestProvider,
  type ToolRegistrar,
  type RegisteredTool,
  type ToolResult,
  type ToolResultContent,
  type ErrorPattern,
};
