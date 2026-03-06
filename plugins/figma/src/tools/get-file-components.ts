import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi } from '../figma-api.js';

const componentSchema = z.object({
  key: z.string().describe('Unique component key'),
  name: z.string().describe('Component name'),
  description: z.string().describe('Component description'),
  node_id: z.string().describe('Node ID in the file'),
  thumbnail_url: z.string().nullable().describe('URL to the component thumbnail, or null'),
  containing_frame: z.string().describe('Name of the frame containing this component'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last updated timestamp'),
});

interface RawComponent {
  key?: string;
  name?: string;
  description?: string;
  node_id?: string;
  thumbnail_url?: string | null;
  containing_frame?: { name?: string };
  created_at?: string;
  updated_at?: string;
}

const mapComponent = (c: Partial<RawComponent>): z.infer<typeof componentSchema> => ({
  key: c.key ?? '',
  name: c.name ?? '',
  description: c.description ?? '',
  node_id: c.node_id ?? '',
  thumbnail_url: c.thumbnail_url ?? null,
  containing_frame: c.containing_frame?.name ?? '',
  created_at: c.created_at ?? '',
  updated_at: c.updated_at ?? '',
});

export const getFileComponents = defineTool({
  name: 'get_file_components',
  displayName: 'Get File Components',
  description:
    'List all published components in a Figma file. Returns component names, descriptions, and keys for use in design systems.',
  summary: 'List components in a file',
  icon: 'puzzle',
  group: 'Files',
  input: z.object({
    file_key: z.string().min(1).describe('File key to list components for'),
  }),
  output: z.object({
    components: z.array(componentSchema).describe('Array of published components'),
  }),
  handle: async params => {
    const data = await figmaApi<{ meta?: { components?: RawComponent[] } }>(`/files/${params.file_key}/components`);
    const rawComponents = data.meta?.components ?? [];
    return { components: rawComponents.map(mapComponent) };
  },
});
