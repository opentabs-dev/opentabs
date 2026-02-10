// =============================================================================
// Slack Plugin — Tools Entry Point
//
// This is the module referenced by opentabs-plugin.json's "tools.entry" field.
// It must export a named `registerTools` function matching the standard
// ToolRegistrationFn signature.
//
// Optionally exports `isHealthy` — a custom health check evaluator that the
// platform's plugin-loader wires into the service controller. Slack needs this
// because the Slack Web API wraps its own errors inside successful JSON-RPC
// responses (the response is technically not a JSON-RPC error, but the
// response.result.ok field is false).
// =============================================================================

import { registerChannelTools } from './channels.js';
import { registerConversationTools } from './conversations.js';
import { registerFileTools } from './files.js';
import { registerMessageTools } from './messages.js';
import { registerPinTools } from './pins.js';
import { registerReactionTools } from './reactions.js';
import { registerSearchTools } from './search.js';
import { registerStarTools } from './stars.js';
import { registerUserTools } from './users.js';
import { registerErrorPatterns } from '@opentabs/plugin-sdk/server';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Tool Registration Function Type
// ---------------------------------------------------------------------------

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

// ---------------------------------------------------------------------------
// Slack-Specific Error Patterns
//
// These patterns provide user-friendly error messages for common Slack API
// errors. They are registered with the SDK's extensible error pattern system
// so that the generic `error()` wrapper in tool handlers formats them nicely.
// ---------------------------------------------------------------------------

const SLACK_ERROR_PATTERNS = [
  {
    match: (msg: string) => msg.includes('channel_not_found') || msg.includes('Channel not found'),
    format: () =>
      'Channel not found. Please check the channel name or ID is correct. ' +
      'For private channels, use the channel ID (starts with C).',
  },
  {
    match: (msg: string) => msg.includes('not_in_channel'),
    format: () => 'You are not a member of this channel. Join the channel first.',
  },
  {
    match: (msg: string) => msg.includes('invalid_auth') || msg.includes('not_authed'),
    format: () =>
      'Slack authentication failed. Please refresh your Slack tab and try again. ' +
      'If the issue persists, sign out and back in.',
  },
  {
    match: (msg: string) => msg.includes('ratelimited'),
    format: () => 'Rate limited by Slack. Please wait a moment and try again.',
  },
  {
    match: (msg: string) => msg.includes('missing_scope'),
    format: () => 'Missing Slack permissions. Your session may not have the required OAuth scopes for this feature.',
  },
  {
    match: (msg: string) => msg.includes('user_not_found'),
    format: () => 'Slack user not found. Please check the user ID is correct.',
  },
  {
    match: (msg: string) => msg.includes('token_revoked'),
    format: () => 'Slack token has been revoked. Please sign out and back in to Slack.',
  },
  {
    match: (msg: string) => msg.includes('no_text'),
    format: () => 'Message text is required. Please provide a non-empty message.',
  },
  {
    match: (msg: string) => msg.includes('too_many_attachments'),
    format: () => 'Too many attachments on this message. Slack limits the number of attachments per message.',
  },
  {
    match: (msg: string) => msg.includes('message_not_found'),
    format: () => 'Message not found. The message may have been deleted or the timestamp is incorrect.',
  },
  {
    match: (msg: string) => msg.includes('cant_delete_message'),
    format: () => "You can only delete your own messages. You don't have permission to delete this message.",
  },
  {
    match: (msg: string) => msg.includes('cant_update_message'),
    format: () => "You can only edit your own messages. You don't have permission to update this message.",
  },
];

// Register Slack error patterns with the SDK on module load.
// These are checked after platform-level patterns; first match wins.
registerErrorPatterns(SLACK_ERROR_PATTERNS);

// ---------------------------------------------------------------------------
// All Tool Registrations
//
// Each tool module exports a registration function. Adding a new tool file
// requires only importing it here and adding it to this array.
// ---------------------------------------------------------------------------

const TOOL_REGISTRATIONS: ToolRegistrationFn[] = [
  registerMessageTools,
  registerSearchTools,
  registerChannelTools,
  registerConversationTools,
  registerUserTools,
  registerFileTools,
  registerPinTools,
  registerStarTools,
  registerReactionTools,
];

// ---------------------------------------------------------------------------
// registerTools — Required Export
//
// The platform's plugin-loader dynamically imports this module and calls
// registerTools(server) to register all Slack tools on an MCP server instance.
// The returned Map is used by the hot-reload system to update tool handlers
// on existing sessions without disconnecting clients.
// ---------------------------------------------------------------------------

/**
 * Register all Slack MCP tools on the given server.
 *
 * @param server - The MCP server instance to register tools on
 * @returns A Map of tool name → RegisteredTool for hot-reload tracking
 */
export const registerTools = (server: McpServer): Map<string, RegisteredTool> => {
  const allTools = new Map<string, RegisteredTool>();

  for (const register of TOOL_REGISTRATIONS) {
    for (const [name, tool] of register(server)) {
      allTools.set(name, tool);
    }
  }

  return allTools;
};

// ---------------------------------------------------------------------------
// isHealthy — Re-exported from health-check.ts
//
// The health check evaluator lives in a separate module (health-check.ts)
// with minimal dependencies (@opentabs/core only). This allows the browser
// extension build to import it via the ./health-check export path without
// pulling in @modelcontextprotocol/sdk or other server-side dependencies.
//
// The MCP server path loads isHealthy through this barrel export.
// ---------------------------------------------------------------------------

export { isHealthy } from '../health-check.js';
