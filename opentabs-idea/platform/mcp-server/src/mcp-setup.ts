/**
 * MCP server factory.
 * Creates a low-level Server instance and registers tools dynamically from plugins.
 * Uses the low-level API to support raw JSON Schema from plugin manifests.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerState } from "./state.js";
import { prefixedToolName, isToolEnabled } from "./state.js";
import {
  dispatchToolToExtension,
  sendInvocationStart,
  sendInvocationEnd,
  DispatchError,
} from "./extension-protocol.js";

/**
 * Create a new low-level MCP Server instance with the OpenTabs server info.
 * Registers handlers for tools/list and tools/call.
 */
export const createMcpServer = (state: ServerState): Server => {
  const server = new Server(
    { name: "opentabs", version: "0.0.1" },
    {
      capabilities: {
        tools: { listChanged: true },
        logging: {},
      },
    }
  );

  // Handler: tools/list — return enabled tools with JSON Schema
  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }> = [];

    for (const plugin of state.plugins.values()) {
      for (const toolDef of plugin.tools) {
        const prefixed = prefixedToolName(plugin.name, toolDef.name);
        if (!isToolEnabled(state, prefixed)) continue;

        tools.push({
          name: prefixed,
          description: toolDef.description,
          inputSchema: toolDef.input_schema,
        });
      }
    }

    return { tools };
  });

  // Handler: tools/call — dispatch to extension
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    // Find which plugin owns this tool
    let foundPlugin: string | undefined;
    let foundTool: string | undefined;

    for (const plugin of state.plugins.values()) {
      for (const toolDef of plugin.tools) {
        const prefixed = prefixedToolName(plugin.name, toolDef.name);
        if (prefixed === toolName) {
          foundPlugin = plugin.name;
          foundTool = toolDef.name;
          break;
        }
      }
      if (foundPlugin) break;
    }

    if (!foundPlugin || !foundTool) {
      return {
        content: [{ type: "text" as const, text: `Tool ${toolName} not found` }],
        isError: true,
      };
    }

    const prefixed = prefixedToolName(foundPlugin, foundTool);
    if (!isToolEnabled(state, prefixed)) {
      return {
        content: [{ type: "text" as const, text: `Tool ${toolName} is disabled` }],
        isError: true,
      };
    }

    // Send invocation start notification to extension (for side panel)
    sendInvocationStart(state, foundPlugin, foundTool);
    const startTs = Date.now();
    let success = true;

    try {
      if (!state.extensionWs) {
        success = false;
        return {
          content: [
            {
              type: "text" as const,
              text: "Extension not connected. Please ensure the OpenTabs Chrome extension is running.",
            },
          ],
          isError: true,
        };
      }

      const result = await dispatchToolToExtension(
        state,
        foundPlugin,
        foundTool,
        args
      );
      const output =
        (result as Record<string, unknown>)?.output ?? result;

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(output, null, 2) },
        ],
      };
    } catch (err) {
      success = false;

      if (err instanceof DispatchError) {
        const code = err.code;
        let errorMsg = err.message;

        if (code === -32001) {
          errorMsg = `Tab closed: ${errorMsg}`;
        } else if (code === -32002) {
          errorMsg = `Tab unavailable: ${errorMsg}`;
        }

        return {
          content: [{ type: "text" as const, text: errorMsg }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Tool dispatch error: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    } finally {
      const durationMs = Date.now() - startTs;
      sendInvocationEnd(state, foundPlugin, foundTool, durationMs, success);
    }
  });

  return server;
};

/**
 * Notify connected MCP clients that the tool list has changed.
 */
export const notifyToolListChanged = (server: Server): void => {
  server.sendToolListChanged().catch(() => {
    // Not connected or no clients — ignore
  });
};
