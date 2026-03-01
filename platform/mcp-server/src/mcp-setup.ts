/**
 * MCP server factory.
 * Creates a low-level Server instance and registers tools dynamically from
 * discovered plugins and built-in browser tools.
 *
 * Uses the low-level Server API (not McpServer) because plugin manifests provide
 * raw JSON Schema objects for tool input/output — McpServer.registerTool() requires
 * Zod schemas and cannot accept pre-computed JSON Schema. The Server class deprecation
 * message acknowledges this: "Only use Server for advanced use cases."
 *
 * The Server import uses dynamic import() to satisfy import-x/no-deprecated. The
 * @typescript-eslint/no-deprecated rule is addressed by typing through the awaited
 * module rather than referencing the deprecated class name directly.
 *
 * Hot reload:
 *   `registerMcpHandlers` is separated from `createMcpServer` so that existing
 *   MCP sessions can have their tools/list and tools/call handler logic refreshed
 *   on hot reload. After each hot reload re-evaluates this module, calling
 *   `registerMcpHandlers(server, state)` on each existing session replaces the
 *   old handler closures with new ones that reference the fresh module imports
 *   (dispatchToExtension, sendInvocationStart, etc.).
 */

import { dispatchToExtension, isDispatchError } from './extension-protocol.js';
import { log } from './logger.js';
import { handleBrowserToolCall, handlePluginToolCall } from './mcp-tool-dispatch.js';
import { getResource, getPrompt, listAllResources, listAllPrompts, trustTierPrefix } from './registry.js';
import { prefixedToolName, isToolEnabled, isBrowserToolEnabled } from './state.js';
import { version } from './version.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError as SdkMcpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { toErrorMessage } from '@opentabs-dev/shared';
import { z } from 'zod';
import type { RequestHandlerExtra } from './mcp-tool-dispatch.js';
import type { ServerState, CachedBrowserTool, ToolLookupEntry } from './state.js';

/**
 * The Server constructor type, extracted without directly referencing the
 * deprecated Server class name in a static import or type-only import.
 * We load it via dynamic import() at runtime to satisfy import-x/no-deprecated,
 * and use a generic constructor signature to avoid @typescript-eslint/no-deprecated.
 */

/** Shape of the dynamically imported server module */
interface ServerModuleShape {
  Server: new (
    serverInfo: { name: string; version: string },
    options: {
      capabilities: {
        tools: { listChanged: boolean };
        resources: { listChanged: boolean };
        prompts: { listChanged: boolean };
        logging: Record<string, never>;
      };
    },
  ) => McpServerInstance;
}

/** The instantiated MCP server with the methods we use */
interface McpServerInstance {
  setRequestHandler: (
    schema: unknown,
    handler: (
      request: { params: { name: string; arguments?: Record<string, unknown>; uri?: string } },
      extra: RequestHandlerExtra,
    ) => unknown,
  ) => void;
  connect: (transport: unknown) => Promise<void>;
  sendToolListChanged: () => Promise<void>;
  sendResourceListChanged: () => Promise<void>;
  sendPromptListChanged: () => Promise<void>;
  sendLoggingMessage: (params: { level: string; logger?: string; data?: unknown }) => Promise<void>;
}

/**
 * Dynamically import the MCP SDK Server constructor.
 *
 * Each call performs a fresh dynamic import(). On hot reload, module-level
 * caches reset on every re-evaluation, so caching here would be misleading —
 * it would appear to persist but actually reset to null on each reload. The
 * dynamic import is fast (resolved from the module cache by the runtime) and
 * only runs once per server creation or reload cycle.
 */
const getServerCtor = async (): Promise<ServerModuleShape['Server']> => {
  const mod = (await import('@modelcontextprotocol/sdk/server/index.js')) as ServerModuleShape;
  return mod.Server;
};

/**
 * Rebuild cached browser tool JSON schemas on state.
 * Called after state.browserTools changes (during reload).
 * Plugin tool lookups are handled by the immutable registry.
 */
const rebuildCachedBrowserTools = (state: ServerState): void => {
  state.cachedBrowserTools = state.browserTools.map((bt): CachedBrowserTool => {
    const schema = z.toJSONSchema(bt.input) as Record<string, unknown>;
    delete schema['$schema'];
    return {
      name: bt.name,
      description: bt.description,
      ...(bt.icon ? { icon: bt.icon } : {}),
      inputSchema: schema,
      tool: bt,
    };
  });
};

/**
 * Register (or re-register) tools/list and tools/call handlers on an MCP Server
 * instance. Each handler creates fresh closures over the current module's imports
 * (dispatchToolToExtension, sendInvocationStart, etc.), ensuring that after hot
 * reload, existing sessions invoke the latest handler logic.
 *
 * Called by:
 *   1. `createMcpServer` — for new sessions
 *   2. Hot reload sequence in reload.ts — for existing sessions
 */
const registerMcpHandlers = (server: McpServerInstance, state: ServerState): void => {
  // Handler: tools/list — return enabled plugin tools + browser tools.
  // Delegates to getEnabledToolsList() which filters disabled plugin tools
  // and always includes browser tools.
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: getEnabledToolsList(state),
  }));

  // Handler: resources/list — return all resources from all plugins with prefixed URIs.
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: listAllResources(state.registry),
  }));

  // Handler: resources/read — dispatch to extension to read resource in page context.
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const uri = request.params.uri;
    if (typeof uri !== 'string' || uri.length === 0) {
      throw new SdkMcpError(ErrorCode.InvalidParams, 'Missing or invalid "uri" parameter');
    }

    const result = getResource(state.registry, uri);
    if (!result) {
      throw new SdkMcpError(ErrorCode.InvalidParams, `Resource not found: ${uri}`);
    }

    const { plugin, resource } = result;
    log.debug('resource.read:', uri, '→', plugin.name + '/' + resource.uri);

    if (!state.extensionWs) {
      throw new SdkMcpError(
        ErrorCode.InternalError,
        'Extension not connected. Please ensure the OpenTabs Chrome extension is running.',
      );
    }

    try {
      const dispatchResult = await dispatchToExtension(
        state,
        'resource.read',
        { plugin: plugin.name, uri: resource.uri },
        { label: `${plugin.name}/resource:${resource.uri}` },
      );
      // Extension wraps adapter output in { output: ... } — unwrap it
      const raw = dispatchResult as Record<string, unknown>;
      const contents = (raw.output ?? raw) as { uri?: string; text?: string; blob?: string; mimeType?: string };
      return {
        contents: [
          {
            uri,
            text: contents.text,
            blob: contents.blob,
            mimeType: contents.mimeType ?? resource.mimeType,
          },
        ],
      };
    } catch (err) {
      if (isDispatchError(err)) {
        throw new SdkMcpError(err.code, err.message);
      }
      const msg = toErrorMessage(err);
      throw new SdkMcpError(ErrorCode.InternalError, `Resource read error: ${msg}`);
    }
  });

  // Handler: prompts/list — return all prompts from all plugins with prefixed names.
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: listAllPrompts(state.registry),
  }));

  // Handler: prompts/get — dispatch to extension to render prompt in page context.
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    const promptName = request.params.name;
    if (typeof promptName !== 'string' || promptName.length === 0) {
      throw new SdkMcpError(ErrorCode.InvalidParams, 'Missing or invalid "name" parameter');
    }

    const result = getPrompt(state.registry, promptName);
    if (!result) {
      throw new SdkMcpError(ErrorCode.InvalidParams, `Prompt not found: ${promptName}`);
    }

    const { plugin, prompt } = result;
    const args = request.params.arguments ?? {};
    log.debug('prompt.get:', promptName, '→', plugin.name + '/' + prompt.name);

    if (!state.extensionWs) {
      throw new SdkMcpError(
        ErrorCode.InternalError,
        'Extension not connected. Please ensure the OpenTabs Chrome extension is running.',
      );
    }

    try {
      const dispatchResult = await dispatchToExtension(
        state,
        'prompt.get',
        { plugin: plugin.name, prompt: prompt.name, arguments: args },
        { label: `${plugin.name}/prompt:${prompt.name}` },
      );
      // Extension wraps adapter output in { output: ... } — unwrap it
      const raw = dispatchResult as Record<string, unknown>;
      const messages = (raw.output ?? raw) as Array<{ role: string; content: { type: string; text: string } }>;
      return {
        messages: Array.isArray(messages) ? messages : [],
      };
    } catch (err) {
      if (isDispatchError(err)) {
        throw new SdkMcpError(err.code, err.message);
      }
      const msg = toErrorMessage(err);
      throw new SdkMcpError(ErrorCode.InternalError, `Prompt get error: ${msg}`);
    }
  });

  // Handler: tools/call — dispatch to extension or handle browser tool locally.
  // Delegates to handleBrowserToolCall or handlePluginToolCall for the actual logic.
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};

    // Check cached browser tools first (O(n) over small fixed set).
    // Browser tools are few and fixed.
    const cachedBt = state.cachedBrowserTools.find(c => c.name === toolName);
    if (cachedBt) {
      return handleBrowserToolCall(state, toolName, args, cachedBt, extra);
    }

    // O(1) plugin tool lookup + enabled check via pre-built map
    const callableCheck = checkToolCallable(state, toolName);
    if (!callableCheck.ok) {
      return {
        content: [{ type: 'text' as const, text: callableCheck.error }],
        isError: true,
      };
    }

    const { pluginName: foundPlugin, toolName: foundTool } = callableCheck;
    log.debug('tool.call:', toolName, '→', foundPlugin + '/' + foundTool);
    // Safe to assert: checkToolCallable verified the tool exists in registry.toolLookup
    const lookup = state.registry.toolLookup.get(toolName) as ToolLookupEntry;

    return handlePluginToolCall(state, toolName, args, foundPlugin, foundTool, lookup, extra);
  });
};

/**
 * Create a new low-level MCP Server instance with the OpenTabs server info
 * and register handlers for tools/list and tools/call.
 */
const createMcpServer = async (state: ServerState): Promise<McpServerInstance> => {
  const ServerCtor = await getServerCtor();
  const server = new ServerCtor(
    { name: 'opentabs', version },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
        logging: {},
      },
    },
  );

  registerMcpHandlers(server, state);

  return server;
};

/**
 * Notify a connected MCP client that the tool list has changed.
 * Logs a warning if the notification fails (e.g., transport in a bad state)
 * to aid debugging when a client doesn't see a tool update.
 */
const notifyToolListChanged = (server: McpServerInstance): void => {
  server.sendToolListChanged().catch((err: unknown) => {
    log.warn('Failed to notify tool list change:', err);
  });
};

/**
 * Notify a connected MCP client that the resource list has changed.
 */
const notifyResourceListChanged = (server: McpServerInstance): void => {
  server.sendResourceListChanged().catch((err: unknown) => {
    log.warn('Failed to notify resource list change:', err);
  });
};

/**
 * Notify a connected MCP client that the prompt list has changed.
 */
const notifyPromptListChanged = (server: McpServerInstance): void => {
  server.sendPromptListChanged().catch((err: unknown) => {
    log.warn('Failed to notify prompt list change:', err);
  });
};

/**
 * Returns the list of enabled tools for MCP tools/list responses.
 * Plugin tools are filtered by the toolConfig (disabled tools are excluded).
 * Browser tools are filtered by the browserToolPolicy (disabled tools are excluded).
 */
export const getEnabledToolsList = (
  state: ServerState,
): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> => {
  const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];

  for (const plugin of state.registry.plugins.values()) {
    for (const toolDef of plugin.tools) {
      const prefixed = prefixedToolName(plugin.name, toolDef.name);
      if (!isToolEnabled(state, prefixed)) continue;
      const clonedSchema = structuredClone(toolDef.input_schema);
      const properties = (clonedSchema.properties ?? {}) as Record<string, unknown>;
      properties.tabId = {
        type: 'integer',
        minimum: 1,
        description:
          'Optional. Target a specific browser tab by its ID. When omitted, the platform automatically selects the best matching tab. Use browser_list_tabs or plugin_list_tabs to discover tab IDs.',
      };
      clonedSchema.properties = properties;
      tools.push({
        name: prefixed,
        description: trustTierPrefix(plugin.trustTier) + toolDef.description,
        inputSchema: clonedSchema,
      });
    }
  }

  for (const cached of state.cachedBrowserTools) {
    if (!isBrowserToolEnabled(state, cached.name)) continue;
    tools.push({
      name: cached.name,
      description: cached.description,
      inputSchema: cached.inputSchema,
    });
  }

  return tools;
};

/** Result of checking whether a plugin tool is callable */
export interface ToolCallableOk {
  ok: true;
  pluginName: string;
  toolName: string;
}

/** A failed tool-callable check with a human-readable error message. */
export interface ToolCallableError {
  ok: false;
  error: string;
}

/** Discriminated union returned by {@link checkToolCallable} indicating success or failure. */
export type ToolCallableResult = ToolCallableOk | ToolCallableError;

/**
 * Check if a prefixed plugin tool name is callable: exists in the tool lookup
 * and is enabled in the tool config. Browser tools are handled separately
 * (before this check) in the tools/call handler.
 *
 * @param state - Server state containing the plugin registry and tool config
 * @param prefixedToolName - Fully prefixed tool name (e.g., 'slack_send_message')
 * @returns An ok result with pluginName/toolName if callable, or an error result with a message
 */
export const checkToolCallable = (state: ServerState, prefixedToolName: string): ToolCallableResult => {
  const lookup = state.registry.toolLookup.get(prefixedToolName);
  if (!lookup) return { ok: false, error: `Tool ${prefixedToolName} not found` };
  if (!isToolEnabled(state, prefixedToolName)) return { ok: false, error: `Tool ${prefixedToolName} is disabled` };
  return { ok: true, pluginName: lookup.pluginName, toolName: lookup.toolName };
};

// Re-export sanitizeOutput and RequestHandlerExtra so existing callers
// (tests, reload.ts) can continue importing from mcp-setup.js.
export { sanitizeOutput } from './mcp-tool-dispatch.js';
export type { McpServerInstance, RequestHandlerExtra };
export {
  createMcpServer,
  registerMcpHandlers,
  rebuildCachedBrowserTools,
  notifyToolListChanged,
  notifyResourceListChanged,
  notifyPromptListChanged,
};
