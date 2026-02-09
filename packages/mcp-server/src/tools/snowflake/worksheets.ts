import { success, sendServiceRequest, defineTool } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerSnowflakeWorksheetTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List worksheets
  defineTool(
    tools,
    server,
    'snowflake_list_worksheets',
    {
      description: `List saved Snowflake worksheets for the current user.

Returns worksheets with: entityId, name, created/modified timestamps, role, URL, and visibility (private/organization).
Worksheets are the SQL editor tabs in the Snowflake web UI.`,
      inputSchema: {},
    },
    async () => {
      const result = await sendServiceRequest(
        'snowflake',
        {
          location: 'worksheets',
          types: ['query', 'folder'],
        },
        'listEntities',
      );

      return success(result);
    },
  );

  // List folders
  defineTool(
    tools,
    server,
    'snowflake_list_folders',
    {
      description: `List worksheet folders in Snowflake. Returns folder entities used to organize worksheets.`,
      inputSchema: {},
    },
    async () => {
      const result = await sendServiceRequest(
        'snowflake',
        {
          location: 'worksheets',
          types: ['folder'],
        },
        'listEntities',
      );

      return success(result);
    },
  );

  // List files
  defineTool(
    tools,
    server,
    'snowflake_list_files',
    {
      description: `List worksheet drafts with their full SQL content and execution context.

Returns drafts keyed by worksheet entityId, each containing:
- query: the full SQL text of the worksheet
- queryLanguage: "sql" or "python"
- executionContext: {database, role, schema, warehouse}
- modifiedTime: last edit timestamp

This is the only way to retrieve the actual SQL content of saved worksheets.`,
      inputSchema: {},
    },
    async () => {
      // Files are accessible via the folders endpoint which returns all models
      const result = await sendServiceRequest('snowflake', {
        endpoint: '/v0/folders',
        method: 'GET',
      });

      return success(result);
    },
  );

  return tools;
};
