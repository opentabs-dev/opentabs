import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const listComponents = defineTool({
  name: 'list_components',
  displayName: 'List Components',
  description:
    'List all components (widgets, queries, frames) in a Retool app. Parses the Transit-encoded app state and returns a human-readable list with component IDs, types, positions, and key properties.',
  summary: 'List all components in an app',
  icon: 'layers',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID'),
  }),
  output: z.object({
    components: z
      .array(
        z.object({
          id: z.string().describe('Component ID'),
          type: z.string().describe('Component type (widget, frame, screen, datasource, instrumentation)'),
          subtype: z.string().describe('Widget subtype (e.g., TextWidget, ButtonWidget2, TableWidget2)'),
          container: z.string().describe('Parent container ID'),
          position: z
            .object({
              row: z.number(),
              col: z.number(),
              width: z.number(),
              height: z.number(),
            })
            .nullable()
            .describe('Grid position (null for non-widget components)'),
          properties: z.record(z.string(), z.unknown()).describe('Key template properties'),
        }),
      )
      .describe('List of components'),
  }),
  handle: async params => {
    const data = await api<{ page: { data: { appState: string } } }>(`/api/pages/uuids/${params.page_uuid}`);
    const appState = data.page?.data?.appState;
    if (!appState) throw ToolError.notFound('App state not found');

    const parsed = JSON.parse(appState);
    const components: Array<{
      id: string;
      type: string;
      subtype: string;
      container: string;
      position: { row: number; col: number; width: number; height: number } | null;
      properties: Record<string, unknown>;
    }> = [];

    const pluginsMap = findPluginsMap(parsed);
    if (!pluginsMap) return { components };

    const entries = pluginsMap[1] as unknown[];
    for (let i = 0; i < entries.length; i += 2) {
      const id = entries[i] as string;
      const record = entries[i + 1] as unknown[];
      const plugin = extractPlugin(record);
      if (plugin) {
        components.push({ id, ...plugin });
      }
    }

    return { components };
  },
});

function findPluginsMap(parsed: unknown[]): unknown[] | null {
  const templateMap = parsed[1] as unknown[];
  const vIdx = templateMap.indexOf('v');
  if (vIdx === -1) return null;
  const appMap = templateMap[vIdx + 1] as unknown[];

  for (let i = 1; i < appMap.length; i += 2) {
    if (appMap[i] === 'plugins') {
      const plugins = appMap[i + 1] as unknown[];
      if (Array.isArray(plugins) && plugins[0] === '~#iOM') {
        return plugins;
      }
    }
  }
  return null;
}

function isTransitRecord(arr: unknown[]): boolean {
  const tag = arr[0] as string;
  return tag === '~#iR' || (typeof tag === 'string' && tag.startsWith('^'));
}

function extractPlugin(record: unknown[]): {
  type: string;
  subtype: string;
  container: string;
  position: { row: number; col: number; width: number; height: number } | null;
  properties: Record<string, unknown>;
} | null {
  if (!Array.isArray(record) || !isTransitRecord(record)) return null;
  const map = record[1] as unknown[];
  // In Transit, 'v' might be backreferenced. Find it by looking for 'v' or the value that follows 'n'/'pluginTemplate'
  let vIdx = map.indexOf('v');
  if (vIdx === -1) {
    // After backreferencing, the map is ["^ ", key, val, key, val, ...]
    // The second key-value pair should be the value (index 3 in the original is 'v')
    // In backreferenced form: ["^ ", "n", "pluginTemplate", "v", [...]] still has literal "v"
    // If not found, try index 3 directly (positional)
    if (map.length >= 5 && Array.isArray(map[4])) {
      vIdx = 3;
    } else {
      return null;
    }
  }
  const vals = map[vIdx + 1] as unknown[];

  const props: Record<string, unknown> = {};
  let type = '';
  let subtype = '';
  let container = '';
  let position: { row: number; col: number; width: number; height: number } | null = null;

  for (let i = 1; i < vals.length; i += 2) {
    const key = vals[i] as string;
    const val = vals[i + 1];

    if (key === 'type' || key === '^18') type = val as string;
    else if (key === 'subtype' || key === '^19') subtype = val as string;
    else if (key === 'container' || key === '^1C') container = val as string;
    else if ((key === 'position2' || key === '^1?') && val != null) {
      position = extractPosition(val as unknown[]);
    } else if ((key === 'template' || key === '^1=') && val != null) {
      Object.assign(props, extractTemplateProps(val as unknown[]));
    }
  }

  return { type, subtype, container, position, properties: props };
}

function extractPosition(pos: unknown[]): { row: number; col: number; width: number; height: number } | null {
  if (!Array.isArray(pos) || !isTransitRecord(pos)) return null;
  const map = pos[1] as unknown[];
  const vIdx = map.indexOf('v');
  if (vIdx === -1) return null;
  const vals = map[vIdx + 1] as unknown[];

  let row = 0;
  let col = 0;
  let width = 0;
  let height = 0;

  for (let i = 1; i < vals.length; i += 2) {
    const key = vals[i] as string;
    if (key === 'row') row = vals[i + 1] as number;
    else if (key === 'col') col = vals[i + 1] as number;
    else if (key === 'width') width = vals[i + 1] as number;
    else if (key === 'height') height = vals[i + 1] as number;
  }

  return { row, col, width, height };
}

function extractTemplateProps(template: unknown[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (!Array.isArray(template)) return props;

  let entries: unknown[];
  const tag = template[0] as string;
  if (tag === '~#iM' || tag === '~#iOM' || (typeof tag === 'string' && tag.startsWith('^'))) {
    entries = template[1] as unknown[];
  } else {
    return props;
  }

  const importantKeys = [
    'value',
    'text',
    'query',
    'title',
    'format',
    'hidden',
    'disabled',
    'data',
    'resourceName',
    'httpMethod',
    'type',
    'padding',
  ];

  for (let i = 0; i < entries.length; i += 2) {
    const key = entries[i] as string;
    const val = entries[i + 1];
    if (importantKeys.includes(key) && val != null && val !== '' && val !== false) {
      props[key] = val;
    }
  }

  return props;
}
