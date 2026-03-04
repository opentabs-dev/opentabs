import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi, getAuthContext } from '../figma-api.js';

const recentFileSchema = z.object({
  id: z.string().describe('Prototype/page ID'),
  file_key: z.string().describe('File key'),
  file_name: z.string().describe('Name of the file'),
  page_name: z.string().describe('Name of the page/frame'),
  url: z.string().describe('URL to the prototype'),
  accessed_at: z.string().describe('ISO 8601 timestamp of last access'),
  thumbnail_url: z.string().nullable().describe('URL to the thumbnail image'),
});

interface RawRecentPrototype {
  id?: string;
  file_key?: string;
  name?: string;
  url?: string;
  accessed_at?: string;
  thumbnail_url?: string | null;
  fig_file?: { key?: string; name?: string };
}

const mapRecentFile = (r: Partial<RawRecentPrototype>): z.infer<typeof recentFileSchema> => ({
  id: r.id ?? '',
  file_key: r.file_key ?? r.fig_file?.key ?? '',
  file_name: r.fig_file?.name ?? '',
  page_name: r.name ?? '',
  url: r.url ?? '',
  accessed_at: r.accessed_at ?? '',
  thumbnail_url: r.thumbnail_url ?? null,
});

export const listRecentFiles = defineTool({
  name: 'list_recent_files',
  displayName: 'List Recent Files',
  description: 'List recently accessed Figma files and prototypes',
  icon: 'clock',
  group: 'Files',
  input: z.object({}),
  output: z.object({
    recent_files: z.array(recentFileSchema).describe('Array of recently accessed files'),
  }),
  handle: async () => {
    const { fuid } = getAuthContext();
    const data = await figmaApi<{ meta?: { recent_prototypes?: RawRecentPrototype[] } }>('/recent_prototypes', {
      query: { is_global: true, include_repo: true, fuid },
    });
    const recentFiles = (data.meta?.recent_prototypes ?? []).map(mapRecentFile);
    return { recent_files: recentFiles };
  },
});
