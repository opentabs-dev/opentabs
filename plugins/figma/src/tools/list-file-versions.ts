import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi } from '../figma-api.js';

const versionSchema = z.object({
  id: z.string().describe('Version ID'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  label: z.string().describe('Version label'),
  description: z.string().describe('Version description'),
  user_handle: z.string().describe('Display name of the version creator'),
});

interface RawVersion {
  id?: string | number;
  created_at?: string;
  label?: string;
  description?: string;
  user?: { handle?: string; img_url?: string; id?: string };
}

const mapVersion = (v: Partial<RawVersion>): z.infer<typeof versionSchema> => ({
  id: String(v.id ?? ''),
  created_at: v.created_at ?? '',
  label: v.label ?? '',
  description: v.description ?? '',
  user_handle: v.user?.handle ?? '',
});

export const listFileVersions = defineTool({
  name: 'list_file_versions',
  displayName: 'List File Versions',
  description: 'List version history of a Figma file. Returns version labels, timestamps, and authors.',
  summary: 'List file version history',
  icon: 'history',
  group: 'Files',
  input: z.object({
    file_key: z.string().min(1).describe('File key to list versions for'),
  }),
  output: z.object({
    versions: z.array(versionSchema).describe('Array of file versions'),
  }),
  handle: async params => {
    const data = await figmaApi<{ meta?: { versions?: RawVersion[] } }>(`/files/${params.file_key}/versions`);
    const rawVersions = data.meta?.versions ?? [];
    return { versions: rawVersions.map(mapVersion) };
  },
});
