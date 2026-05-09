import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const createResource = defineTool({
  name: 'create_resource',
  displayName: 'Create Resource',
  description:
    'Create a new resource (data source) in Retool. Resources are connections to external services like REST APIs, databases (PostgreSQL, MySQL), GraphQL endpoints, and more. Once created, queries in apps can reference the resource by name.',
  summary: 'Create a new data source resource',
  icon: 'database',
  group: 'Resources',
  input: z.object({
    display_name: z.string().describe('Human-readable name for the resource'),
    type: z
      .enum(['restapi', 'postgresql', 'mysql', 'graphql', 'mongodb', 'redis', 'snowflake', 's3', 'googlesheets'])
      .describe('Resource type'),
    options: z
      .record(z.string(), z.unknown())
      .describe(
        'Configuration options (varies by type). For restapi: { baseURL, headers, authentication }. For postgresql: { host, port, databaseName, databaseUsername, databasePassword, ssl }.',
      ),
    folder_id: z.number().optional().describe('Resource folder ID (default: root folder)'),
  }),
  output: z.object({
    id: z.number().describe('Numeric resource ID'),
    uuid: z.string().describe('Resource UUID'),
    name: z.string().describe('Internal resource name'),
    display_name: z.string().describe('Display name'),
    type: z.string().describe('Resource type'),
  }),
  handle: async params => {
    const data = await api<{
      id: number;
      uuid: string;
      name: string;
      displayName: string;
      type: string;
    }>('/api/resources', {
      method: 'POST',
      body: {
        displayName: params.display_name,
        type: params.type,
        options: params.options,
        ...(params.folder_id != null ? { resourceFolderId: params.folder_id } : {}),
      },
    });

    return {
      id: data.id ?? 0,
      uuid: data.uuid ?? '',
      name: data.name ?? '',
      display_name: data.displayName ?? '',
      type: data.type ?? '',
    };
  },
});
