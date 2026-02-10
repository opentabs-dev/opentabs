// =============================================================================
// Extension Reload Tool — Platform-Native
//
// A platform-native tool that reloads the Chrome extension. This is used during
// development to apply changes to the extension's background script, adapters,
// and content scripts without manually navigating to chrome://extensions.
//
// This tool is part of the platform infrastructure — it's not a plugin and
// doesn't use any webapp adapter. It communicates directly with the extension's
// background script via the WebSocket relay's system.reload method.
//
// After reload, the extension briefly disconnects and reconnects. Adapter
// scripts are re-injected into matching tabs automatically. The MCP server
// stays running (it's a separate process).
// =============================================================================

import {
  createToolRegistrar,
  reloadExtension,
  success,
} from '@opentabs/plugin-sdk/server';

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

export const registerExtensionReloadTools = (
  server: McpServer,
): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // -------------------------------------------------------------------------
  // Reload extension
  // -------------------------------------------------------------------------

  define(
    'reload_extension',
    {
      description:
        'Reload the OpenTabs Chrome extension. Use this after building extension-side ' +
        'changes (adapters, background script, service controllers, UI pages) to apply ' +
        'them without manually reloading from chrome://extensions.\n\n' +
        'The extension will briefly disconnect (~1-2 seconds) and then reconnect ' +
        'automatically. Adapter scripts are re-injected into matching tabs on reconnect.\n\n' +
        'This tool is NOT needed after MCP server changes — those are applied via ' +
        'hot reload automatically. Only use this for extension-side changes.\n\n' +
        'Typical workflow:\n' +
        '1. Edit extension source files\n' +
        '2. Build: turbo build --filter=chrome-extension...\n' +
        '3. Call this tool to reload\n' +
        '4. Wait 2-3 seconds for reconnection\n' +
        '5. Test the affected tools',
      annotations: {
        destructiveHint: true,
      },
    },
    async () => {
      const result = await reloadExtension();
      return success({
        ...result,
        message:
          'Extension reload initiated. The extension will disconnect briefly and ' +
          'reconnect automatically within a few seconds. Adapter scripts will be ' +
          're-injected into matching tabs.',
      });
    },
  );

  return tools;
};
