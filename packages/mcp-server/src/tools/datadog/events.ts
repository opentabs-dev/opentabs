// Events API requires API key authentication and does not work with browser session auth.

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogEventsTools = (_server: McpServer): Map<string, RegisteredTool> => {
  // Events API endpoints (/api/v1/events) require API key authentication
  // and return 401 Unauthorized when using session cookies.
  void _server; // Explicitly void to satisfy no-unused-vars
  return new Map();
};
