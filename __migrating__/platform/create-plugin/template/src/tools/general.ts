// =============================================================================
// {{displayName}} Plugin — General Tools
//
// Example tool definitions to get started. Each tool uses the SDK's
// createToolRegistrar for clean registration and sendServiceRequest to
// communicate with the adapter running in the browser tab.
//
// Tool naming convention: {{pluginName}}_<action> (e.g. "myservice_list_items")
// =============================================================================

import { createToolRegistrar, sendServiceRequest, success } from '@opentabs/plugin-sdk/server';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export const registerGeneralTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // -------------------------------------------------------------------------
  // Example: Call a REST API endpoint
  //
  // This is the most common pattern — forward a request to the adapter,
  // which calls the web application's API using the user's session.
  // -------------------------------------------------------------------------

  define(
    '{{pluginName}}_api_request',
    {
      description:
        'Make an authenticated API request to {{displayName}}. ' +
        'Specify the endpoint path, HTTP method, and optional request body. ' +
        "The request is made using the user's authenticated browser session.",
      inputSchema: {
        endpoint: z.string().describe('API endpoint path (e.g. "/api/v1/users", "/api/v1/projects")'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
          .optional()
          .default('GET')
          .describe('HTTP method (default: GET)'),
        body: z.record(z.unknown()).optional().describe('Request body for POST/PUT/PATCH requests (JSON object)'),
      },
    },
    async ({ endpoint, method, body }) => {
      const result = await sendServiceRequest('{{pluginName}}', {
        endpoint,
        method: method ?? 'GET',
        body,
      });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Example: A more specific, user-friendly tool
  //
  // Wrap common API calls into purpose-built tools with clear descriptions
  // and typed parameters. AI agents use tool descriptions to decide which
  // tool to call, so specificity matters more than generality.
  // -------------------------------------------------------------------------

  // define(
  //   '{{pluginName}}_list_items',
  //   {
  //     description:
  //       'List items from {{displayName}}. Returns a paginated list of items ' +
  //       'with their IDs, names, and status.',
  //     inputSchema: {
  //       limit: z
  //         .number()
  //         .optional()
  //         .default(20)
  //         .describe('Number of items to return (default: 20, max: 100)'),
  //       offset: z
  //         .number()
  //         .optional()
  //         .default(0)
  //         .describe('Pagination offset (default: 0)'),
  //       status: z
  //         .enum(['active', 'archived', 'all'])
  //         .optional()
  //         .default('active')
  //         .describe('Filter by status (default: "active")'),
  //     },
  //   },
  //   async ({ limit, offset, status }) => {
  //     const result = await sendServiceRequest('{{pluginName}}', {
  //       endpoint: '/api/v1/items',
  //       method: 'GET',
  //       body: {
  //         limit: Math.min(limit ?? 20, 100),
  //         offset: offset ?? 0,
  //         status: status ?? 'active',
  //       },
  //     });
  //     return success(result);
  //   },
  // );

  // define(
  //   '{{pluginName}}_get_item',
  //   {
  //     description:
  //       'Get detailed information about a specific item by its ID.',
  //     inputSchema: {
  //       id: z.string().describe('The item ID'),
  //     },
  //   },
  //   async ({ id }) => {
  //     const result = await sendServiceRequest('{{pluginName}}', {
  //       endpoint: `/api/v1/items/${id}`,
  //       method: 'GET',
  //     });
  //     return success(result);
  //   },
  // );

  return tools;
};
