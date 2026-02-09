import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogNotebooksTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List notebooks
  define(
    'datadog_list_notebooks',
    {
      description: `List Datadog notebooks for documentation and investigation sharing.

Notebooks are collaborative documents that combine:
- Live metrics and graphs
- Log queries
- Markdown documentation
- Investigation notes

Useful for:
- Finding existing runbooks and documentation
- Discovering past incident investigations
- Sharing context with team members`,
      inputSchema: {
        query: z.string().optional().describe('Search query to filter notebooks by name'),
        authorHandle: z.string().optional().describe('Filter by author email/handle'),
        limit: z.number().optional().default(50).describe('Maximum notebooks to return (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, authorHandle, limit, env }) => {
      const params: Record<string, string> = {
        count: String(limit ?? 50),
      };

      if (query) {
        params.query = query;
      }
      if (authorHandle) {
        params.author_handle = authorHandle;
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/notebooks',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      const response = result as {
        data?: Array<{
          id?: number;
          type?: string;
          attributes?: {
            name?: string;
            author?: {
              handle?: string;
              name?: string;
            };
            created?: string;
            modified?: string;
            status?: string;
            cells?: Array<{
              id?: string;
              type?: string;
              attributes?: {
                definition?: {
                  type?: string;
                  text?: string;
                };
              };
            }>;
            time?: {
              live_span?: string;
            };
          };
        }>;
        meta?: {
          page?: {
            total_count?: number;
            total_filtered_count?: number;
          };
        };
      };

      const notebooks = (response.data || []).map(nb => ({
        id: nb.id,
        name: nb.attributes?.name,
        author: nb.attributes?.author,
        created: nb.attributes?.created,
        modified: nb.attributes?.modified,
        status: nb.attributes?.status,
        cellCount: nb.attributes?.cells?.length ?? 0,
        timeSpan: nb.attributes?.time?.live_span,
        datadogUrl: `https://app.datadoghq.com/notebook/${nb.id}`,
      }));

      return success({
        totalCount: response.meta?.page?.total_count ?? notebooks.length,
        notebooks,
      });
    },
  );

  // Get specific notebook
  define(
    'datadog_get_notebook',
    {
      description: `Get detailed content of a specific notebook.

Returns the full notebook including:
- All cells (graphs, queries, markdown)
- Configuration and time range
- Author information

Use this to view investigation notes, runbooks, or documentation.`,
      inputSchema: {
        notebookId: z.number().describe('The notebook ID'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ notebookId, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/notebooks/${notebookId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      const response = result as {
        data?: {
          id?: number;
          type?: string;
          attributes?: {
            name?: string;
            author?: {
              handle?: string;
              name?: string;
            };
            created?: string;
            modified?: string;
            status?: string;
            cells?: Array<{
              id?: string;
              type?: string;
              attributes?: {
                definition?: {
                  type?: string;
                  text?: string;
                  requests?: Array<{
                    q?: string;
                  }>;
                };
              };
            }>;
            time?: {
              live_span?: string;
            };
          };
        };
      };

      const notebook = response.data;
      if (!notebook) {
        return success({
          notebookId,
          message: 'Notebook not found',
        });
      }

      // Format cells for readability
      const cells = (notebook.attributes?.cells || []).map(cell => {
        const def = cell.attributes?.definition;
        return {
          id: cell.id,
          type: def?.type,
          content: def?.type === 'markdown' ? def.text : undefined,
          queries: def?.requests?.map(r => r.q),
        };
      });

      return success({
        id: notebook.id,
        name: notebook.attributes?.name,
        author: notebook.attributes?.author,
        created: notebook.attributes?.created,
        modified: notebook.attributes?.modified,
        status: notebook.attributes?.status,
        timeSpan: notebook.attributes?.time?.live_span,
        cells,
        datadogUrl: `https://app.datadoghq.com/notebook/${notebook.id}`,
      });
    },
  );

  return tools;
};
