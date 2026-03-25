import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';

interface ClientsRouteData {
  mcpClients: Array<{
    name?: string;
    slug?: string;
    description?: string;
    githubRepository?: { stargazers?: number; fullName?: string };
    attributes?: string[];
  }>;
}

const mcpClientSchema = z.object({
  name: z.string().describe('Client name'),
  slug: z.string().describe('Client slug'),
  description: z.string().describe('Client description'),
  stars: z.number().int().describe('GitHub stars'),
  attributes: z.array(z.string()).describe('Client attributes (platform, OS, pricing)'),
});

export const listMcpClients = defineTool({
  name: 'list_mcp_clients',
  displayName: 'List MCP Clients',
  description:
    'List MCP clients that support the Model Context Protocol (e.g. Claude Desktop, Cursor, Windsurf). Returns client names, slugs, and descriptions.',
  summary: 'List MCP clients that support the Model Context Protocol',
  icon: 'monitor',
  group: 'MCP Clients',
  input: z.object({}),
  output: z.object({
    clients: z.array(mcpClientSchema).describe('MCP clients'),
  }),
  handle: async () => {
    const data = await navigateAndLoad<ClientsRouteData>(
      '/mcp/clients',
      'routes/_public/mcp/clients/_index/_index/_route',
    );

    const clients = (data.mcpClients ?? []).map(c => ({
      name: c.name ?? '',
      slug: c.slug ?? '',
      description: c.description ?? '',
      stars: c.githubRepository?.stargazers ?? 0,
      attributes: c.attributes ?? [],
    }));

    return { clients };
  },
});
