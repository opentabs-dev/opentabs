import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerRetoolAppTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List pages/apps
  define(
    'retool_list_apps',
    {
      description: `List all Retool applications (pages) with their metadata and folder structure.

Returns: pageCount, pages[] (id, uuid, name, folderId, accessLevel, updatedAt, lastEditedBy, description), folders[].
Use the uuid from results with retool_get_app, retool_get_app_docs, retool_list_app_tags, and retool_list_page_saves.`,
      inputSchema: {
        mobileAppsOnly: z.boolean().optional().describe('Filter to mobile apps only'),
        includePublicPages: z.boolean().optional().describe('Include publicly shared pages'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ mobileAppsOnly, includePublicPages, env }) => {
      const params = new URLSearchParams();
      if (mobileAppsOnly !== undefined) params.set('mobileAppsOnly', String(mobileAppsOnly));
      if (includePublicPages !== undefined) params.set('includePublicPages', String(includePublicPages));
      const queryString = params.toString();

      const result = await sendServiceRequest('retool', {
        endpoint: `/api/pages${queryString ? `?${queryString}` : ''}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Shape response: keep essential page fields, add count
      const shaped: Record<string, unknown> = {};
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>;
        const pages = r.pages as Record<string, unknown>[] | undefined;
        if (Array.isArray(pages)) {
          shaped.pageCount = pages.length;
          shaped.pages = pages.map(p => ({
            id: p.id,
            uuid: p.uuid,
            name: p.name,
            folderId: p.folderId,
            accessLevel: p.accessLevel,
            isGlobalWidget: p.isGlobalWidget,
            isMobileApp: p.isMobileApp,
            isFormApp: p.isFormApp,
            protected: p.protected,
            updatedAt: p.updatedAt,
            lastEditedBy: p.lastEditedBy,
            description: p.description,
          }));
        }
        shaped.folders = r.folders;
      }
      return success(shaped);
    },
  );

  // Get app by UUID
  define(
    'retool_get_app',
    {
      description: `Get a Retool application's save data by UUID. Returns the page save record including serialized app state (Transit-encoded in page.data.appState), change history, and metadata. For a human-readable app lookup by path, use retool_lookup_app instead.`,
      inputSchema: {
        pageUuid: z.string().describe('Page/app UUID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ pageUuid, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/pages/uuids/${pageUuid}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Lookup page by path
  define(
    'retool_lookup_app',
    {
      description: `Look up a Retool application by its URL path (e.g., "fraud/fraud"). Returns the full app state including components, queries, and configuration. Use this when you know the app's path but not its UUID.`,
      inputSchema: {
        pagePath: z.string().describe('Page path or name to look up'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ pagePath, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/pages/lookupPage',
        method: 'POST',
        body: { pagePath },
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // Get app documentation
  define(
    'retool_get_app_docs',
    {
      description: `Get the documentation and usage notes for a Retool application. Returns the editor-written description that explains the app's purpose and usage.`,
      inputSchema: {
        pageUuid: z.string().describe('Page/app UUID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ pageUuid, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/pages/uuids/${pageUuid}/documentation`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // List app releases/versions
  define(
    'retool_list_app_tags',
    {
      description: `List published version tags (releases) for a Retool application. Tags are named snapshots deployed to end users. Returns tag IDs, names, and creation timestamps.`,
      inputSchema: {
        pageUuid: z.string().describe('Page/app UUID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ pageUuid, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/pages/uuids/${pageUuid}/tags`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // List page editor names
  define(
    'retool_list_page_names',
    {
      description: `Get a lightweight list of all page/app names and UUIDs in the Retool organization. Faster and smaller than retool_list_apps — use this when you only need names and UUIDs, not full metadata.`,
      inputSchema: {
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: '/api/editor/pageNames',
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      return success(result);
    },
  );

  // List page saves (edit history)
  define(
    'retool_list_page_saves',
    {
      description:
        'List the edit history (saved versions) for a Retool app. Shows who made each save, when, and the save ID. Useful for auditing changes and understanding who last modified an app.',
      inputSchema: {
        pageUuid: z.string().describe('Page/app UUID'),
        env: z.enum(['production', 'staging']).optional().describe('Retool environment (default: production)'),
      },
    },
    async ({ pageUuid, env }) => {
      const result = await sendServiceRequest('retool', {
        endpoint: `/api/pages/uuids/${pageUuid}/saves`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
