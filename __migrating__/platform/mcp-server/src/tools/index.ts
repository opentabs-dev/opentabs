// =============================================================================
// Plugin-Aware Tool Registration
//
// This is the central tool registration module for the MCP server. It replaces
// the original hardcoded SERVICE_REGISTRATIONS array with a dynamic system that
// merges platform-native tools (browser, extension) with tools discovered from
// installed plugins.
//
// The registration pipeline:
//
//   1. Platform-native tools are imported statically (browser, extension).
//      These are always available and don't depend on any webapp tab.
//
//   2. Plugin tools are discovered by @opentabs/plugin-loader at server startup.
//      The loader scans node_modules for packages with opentabs-plugin.json
//      manifests, validates them, dynamically imports their registerTools
//      function, and adds them to the registration pipeline.
//
//   3. registerAllTools() iterates over all registration functions (platform +
//      plugin) and collects the resulting Map<string, RegisteredTool> entries
//      into a single unified map.
//
//   4. The unified map is used by the hot-reload system to diff and patch
//      tools on existing MCP sessions when code changes.
//
// Adding a new platform-native tool: import it and add to PLATFORM_REGISTRATIONS.
// Adding a new plugin: install the npm package. The loader discovers it automatically.
// =============================================================================

import { registerBrowserTabsTools } from './browser/tabs.js';
import { registerCaptureTools } from './capture/index.js';
import { registerExtensionReloadTools } from './extension/reload.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolRegistrationFn } from '@opentabs/core';

// =============================================================================
// Platform-Native Tool Registrations
//
// These are tools that call chrome.* APIs directly through the browser
// controller or manage the extension itself. They don't use webapp adapters
// and are always available when the extension is connected.
//
// Platform tools are imported statically — they're part of the MCP server
// package itself, not external plugins.
// =============================================================================

const PLATFORM_REGISTRATIONS: ToolRegistrationFn[] = [
  registerBrowserTabsTools as ToolRegistrationFn,
  registerExtensionReloadTools as ToolRegistrationFn,
  registerCaptureTools as ToolRegistrationFn,
];

// =============================================================================
// Plugin Tool Registrations — Populated at Startup
//
// Plugin tools are discovered and loaded by the plugin-loader during server
// initialization (in index.ts / server.ts). They're injected into this module
// via setPluginRegistrations() so that registerAllTools() includes them.
//
// This two-phase approach (load plugins → set registrations → create servers)
// ensures that:
// - Plugin loading is async (dynamic imports) but tool registration is sync
// - Hot reload works: on file change, registerAllTools() is called again with
//   the latest tool code from both platform and plugins
// - The tools/index.ts module doesn't need to be async itself
// =============================================================================

let pluginRegistrations: ToolRegistrationFn[] = [];

/**
 * Set the plugin tool registrations discovered by the plugin-loader.
 *
 * Called once during server initialization after loadPlugins() completes.
 * On hot reload, this is called again with the fresh plugin registrations
 * (which may include new plugins installed since the last reload).
 *
 * @param registrations - Array of registerTools functions from loaded plugins
 */
const setPluginRegistrations = (registrations: ToolRegistrationFn[]): void => {
  pluginRegistrations = registrations;
};

/**
 * Get the current plugin registrations. Used by hot-reload to re-collect
 * fresh tool definitions.
 */
const getPluginRegistrations = (): readonly ToolRegistrationFn[] => pluginRegistrations;

/**
 * Get the platform-native registrations. Useful for testing and introspection.
 */
const getPlatformRegistrations = (): readonly ToolRegistrationFn[] => PLATFORM_REGISTRATIONS;

// =============================================================================
// registerAllTools — The Main Entry Point
//
// Called by server.ts when creating a new MCP server instance (for each client
// session) and by the hot-reload system when patching existing sessions.
//
// Returns a Map of all registered tools keyed by tool name. The map is used by:
// - hot-reload: to diff old vs new tools and call RegisteredTool.update()
// - session tracking: to store which tools exist on each session
// =============================================================================

/**
 * Register all tools on an MCP server instance.
 *
 * Merges platform-native tools (browser, extension) with plugin-provided tools.
 * The order is deterministic: platform tools first, then plugin tools in
 * discovery order. Tool names must be globally unique — a collision throws.
 *
 * @param server - The MCP server instance to register tools on
 * @returns A Map of tool name → RegisteredTool for hot-reload tracking
 *
 * @example
 * ```ts
 * // In server.ts when creating a new session:
 * const server = new McpServer({ name: 'OpenTabs', version: '1.0.0' });
 * const tools = registerAllTools(server);
 * registerSession(sessionId, { server, transport, type, tools });
 * ```
 */
const registerAllTools = (server: McpServer): Map<string, RegisteredTool> => {
  const allTools = new Map<string, RegisteredTool>();

  // Combine platform and plugin registrations
  const allRegistrations: ToolRegistrationFn[] = [...PLATFORM_REGISTRATIONS, ...pluginRegistrations];

  for (const register of allRegistrations) {
    // Each registration function returns a Map<string, RegisteredTool>
    const tools = register(server as unknown as Parameters<typeof register>[0]);

    for (const [name, tool] of tools as Map<string, RegisteredTool>) {
      if (allTools.has(name)) {
        // Tool name collision — this is a fatal error. Two plugins or a plugin
        // and a platform tool have the same tool name. The platform enforces
        // unique plugin names, so this should only happen if a plugin author
        // accidentally uses a name that collides with another plugin or a
        // platform tool.
        throw new Error(
          `Tool name collision: "${name}" is already registered. ` +
            'Each tool must have a globally unique name. ' +
            'Plugin tool names should be prefixed with the plugin name ' +
            '(e.g., "slack_send_message", "jira_search_issues").',
        );
      }
      allTools.set(name, tool);
    }
  }

  return allTools;
};

// =============================================================================
// Utility — Tool Count Summary
//
// Useful for health checks and logging.
// =============================================================================

/**
 * Get a summary of registered tool counts by source.
 *
 * @returns Object with platformCount, pluginCount, and totalCount
 */
const getToolCountSummary = (): {
  platformRegistrationCount: number;
  pluginRegistrationCount: number;
  totalRegistrationCount: number;
} => ({
  platformRegistrationCount: PLATFORM_REGISTRATIONS.length,
  pluginRegistrationCount: pluginRegistrations.length,
  totalRegistrationCount: PLATFORM_REGISTRATIONS.length + pluginRegistrations.length,
});

// =============================================================================
// Re-exports — Platform-native tool registrations
//
// Exported individually so that the build system and tests can reference
// specific platform tools without importing from sub-modules.
// =============================================================================

export { registerBrowserTabsTools } from './browser/tabs.js';
export { registerExtensionReloadTools } from './extension/reload.js';
export { registerCaptureTools } from './capture/index.js';

export {
  setPluginRegistrations,
  getPluginRegistrations,
  getPlatformRegistrations,
  registerAllTools,
  getToolCountSummary,
};
