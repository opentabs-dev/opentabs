import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerLogrocketGalileoTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List Galileo AI chats
  defineTool(
    tools,
    server,
    'logrocket_list_galileo_chats',
    {
      description: `List Galileo AI analysis chats for a LogRocket application. Galileo is LogRocket's AI assistant that provides automated root cause analysis for issues and errors.

Returns recent AI analysis conversations including:
- Chat name (typically the error/issue title)
- Chat type (issue_analysis or stream)
- Associated issue ID and type (EXCEPTION, NETWORK_ERROR, etc.)
- Creation and modification timestamps

Use chat IDs with logrocket_get_galileo_chat to retrieve the full analysis.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug (e.g., "brex")'),
        appSlug: z.string().describe('Application slug (e.g., "dashboard-prd")'),
        chatType: z
          .enum(['issue_analysis', 'stream'])
          .optional()
          .default('issue_analysis')
          .describe(
            'Filter by chat type: "issue_analysis" for error analysis, "stream" for freeform AI queries (default: issue_analysis)',
          ),
      },
    },
    async ({ orgSlug, appSlug, chatType }) => {
      const params = new URLSearchParams();
      if (chatType) params.set('chat_type', chatType);

      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/ask-galileo-chats/?${params.toString()}`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // Get Galileo AI chat detail
  defineTool(
    tools,
    server,
    'logrocket_get_galileo_chat',
    {
      description: `Get the full details of a Galileo AI analysis chat, including the AI-generated root cause analysis and recommendations.

Returns:
- Chat metadata (name, type, timestamps)
- Issue analysis details (issue ID, type)
- AI-generated analysis content
- Video availability for session replay analysis

Use logrocket_list_galileo_chats to find chat IDs.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        chatId: z.string().describe('Galileo chat ID (UUID format, from list_galileo_chats results)'),
      },
    },
    async ({ orgSlug, appSlug, chatId }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/ask-galileo-chats/${chatId}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // Create Galileo AI stream (ask a question)
  defineTool(
    tools,
    server,
    'logrocket_create_galileo_stream',
    {
      description: `Ask LogRocket's Galileo AI a question about your application. Creates an AI analysis stream that processes the question asynchronously.

Use this to ask questions like:
- "What are the most common errors today?"
- "Which pages have the highest error rates?"
- "What network requests are failing most frequently?"

The stream is processed asynchronously. Use logrocket_get_galileo_stream to check for results after creation. The AI analyzes your session data and returns insights.

Returns the created stream ID and metadata.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        question: z.string().describe('Question to ask Galileo AI about your application data'),
        interval: z
          .enum(['daily', 'weekly'])
          .optional()
          .default('daily')
          .describe('Time interval for analysis: "daily" (last 24h) or "weekly" (last 7 days). Default: daily'),
      },
    },
    async ({ orgSlug, appSlug, question, interval }) => {
      const chatId = crypto.randomUUID();

      // Step 1: Create a chat container
      await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/ask-galileo-chats/`,
        method: 'POST',
        body: { chat_id: chatId, chat_type: 'stream' },
      });

      // Step 2: Create the analysis stream with the question
      const streamResult = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/ask-galileo-streams/`,
        method: 'POST',
        body: { chat_id: chatId, question, interval: interval ?? 'daily' },
      });

      return success({ chatId, stream: streamResult });
    },
  );

  // Get Galileo AI stream results
  defineTool(
    tools,
    server,
    'logrocket_get_galileo_stream',
    {
      description: `Get the results of a Galileo AI analysis stream. Streams are processed asynchronously after creation with logrocket_create_galileo_stream.

Returns the AI-generated analysis including insights, error patterns, and recommendations based on your session data.

Note: Results may take a few seconds to populate after stream creation. If the response shows empty results, wait and retry.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        streamId: z.string().describe('Stream ID from logrocket_create_galileo_stream results'),
      },
    },
    async ({ orgSlug, appSlug, streamId }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/ask-galileo-streams/${streamId}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  return tools;
};
