import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';

interface CategoryRouteData {
  categories: Array<{
    name?: string;
    lookupKey?: string;
    icon?: string;
    description?: string;
  }>;
}

const categorySchema = z.object({
  name: z.string().describe('Category name'),
  slug: z.string().describe('Category slug (use with list_servers_by_category)'),
  icon: z.string().describe('Category icon name'),
  description: z.string().describe('Category description'),
});

const extractSlug = (lookupKey: string): string => {
  const match = lookupKey.match(/^category:(.+)$/);
  return match?.[1] ?? lookupKey;
};

export const listServerCategories = defineTool({
  name: 'list_server_categories',
  displayName: 'List Categories',
  description:
    'List all MCP server categories in the Glama directory. Returns category names, slugs, icons, and descriptions. Use the slug with list_servers_by_category to browse servers in a category.',
  summary: 'List MCP server categories',
  icon: 'tag',
  group: 'MCP Servers',
  input: z.object({}),
  output: z.object({
    categories: z.array(categorySchema).describe('MCP server categories'),
  }),
  handle: async () => {
    const data = await navigateAndLoad<CategoryRouteData>(
      '/mcp/servers/categories',
      'routes/_public/mcp/servers/categories/_index/_route',
    );

    const categories = (data.categories ?? []).map(c => ({
      name: c.name ?? '',
      slug: extractSlug(c.lookupKey ?? ''),
      icon: c.icon ?? '',
      description: c.description ?? '',
    }));

    return { categories };
  },
});
