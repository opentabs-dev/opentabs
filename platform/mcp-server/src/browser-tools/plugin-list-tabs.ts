/**
 * plugin_list_tabs — lists all matching tabs for a plugin with readiness status.
 *
 * Reads directly from the server's tabMapping (populated by tab.syncAll and
 * tab.stateChanged events from the extension) — no extension dispatch needed.
 * Each tab entry includes a connectionId field identifying which browser profile owns it.
 */

import type { PluginTabInfo, TabState } from '@opentabs-dev/shared';
import { z } from 'zod';
import { pickBestTabState } from '../state.js';
import { defineBrowserTool } from './definition.js';

type AnnotatedTab = PluginTabInfo & { connectionId: string; instance?: string };

interface AnnotatedMapping {
  state: TabState;
  tabs: AnnotatedTab[];
}

/** Extract the host (hostname:port when non-standard) from a Chrome match pattern. */
const hostnameFromPattern = (pattern: string): string | undefined => {
  const match = pattern.match(/^(?:\*|https?|wss?):\/\/([^*/]+)\//);
  if (!match) return undefined;
  const host = match[1];
  if (!host || host.startsWith('*')) return undefined;
  return host;
};

/** Normalize localhost variants (localhost, 127.0.0.1, [::1]) to a canonical form. */
const normalizeHost = (host: string): string => {
  const colonIdx = host.lastIndexOf(':');
  const hasPort = colonIdx > 0 && !host.endsWith(']');
  const hostname = hasPort ? host.slice(0, colonIdx) : host;
  const port = hasPort ? host.slice(colonIdx + 1) : undefined;
  const norm = hostname === '127.0.0.1' || hostname === '[::1]' ? 'localhost' : hostname;
  return port ? `${norm}:${port}` : norm;
};

/** Annotate tabs with the instance name derived from the plugin's instanceMap. */
const annotateTabsWithInstance = (
  tabs: AnnotatedTab[],
  instanceMap: Record<string, string> | undefined,
): AnnotatedTab[] => {
  if (!instanceMap) return tabs;
  return tabs.map(tab => {
    let instance: string | undefined;
    try {
      const tabHost = normalizeHost(new URL(tab.url).host);
      for (const [name, pattern] of Object.entries(instanceMap)) {
        const patternHost = hostnameFromPattern(pattern);
        if (patternHost && normalizeHost(patternHost) === tabHost) {
          instance = name;
          break;
        }
      }
    } catch {
      /* skip invalid URLs */
    }
    return instance !== undefined ? { ...tab, instance } : tab;
  });
};

/**
 * Build a merged tab mapping annotated with connectionId from all connections.
 * Unlike getMergedTabMapping (which is used by the side panel and doesn't need
 * connectionId), this annotates each tab with its source connection.
 */
const getMergedTabMappingWithConnectionId = (
  connections: Iterable<{ connectionId: string; tabMapping: Map<string, { state: TabState; tabs: PluginTabInfo[] }> }>,
): Map<string, AnnotatedMapping> => {
  const merged = new Map<string, AnnotatedMapping>();
  for (const conn of connections) {
    for (const [pluginName, mapping] of conn.tabMapping) {
      const withConn: AnnotatedTab[] = mapping.tabs.map(t => ({ ...t, connectionId: conn.connectionId }));
      const existing = merged.get(pluginName);
      if (existing) {
        existing.tabs.push(...withConn);
        existing.state = pickBestTabState(existing.state, mapping.state);
      } else {
        merged.set(pluginName, { state: mapping.state, tabs: withConn });
      }
    }
  }
  return merged;
};

const pluginListTabs = defineBrowserTool({
  name: 'plugin_list_tabs',
  description:
    "List open browser tabs that match a plugin's URL patterns. Returns tab IDs, URLs, titles, readiness " +
    'status, and connectionId (identifying the browser profile) for each matching tab. Use this to discover which ' +
    'tabs are available before targeting a specific one with the tabId parameter on plugin tools. When called ' +
    'without a plugin argument, returns tabs for all plugins.',
  summary: 'List tabs matching a plugin',
  icon: 'list',
  group: 'Plugins',
  input: z.object({
    plugin: z
      .string()
      .optional()
      .describe(
        'Plugin name. When provided, returns tabs for this plugin only. When omitted, returns tabs for all plugins.',
      ),
  }),
  handler: (_args, state) => {
    const { plugin } = _args;
    const mergedTabs = getMergedTabMappingWithConnectionId(state.extensionConnections.values());

    if (plugin !== undefined) {
      const registered = state.registry.plugins.get(plugin);
      if (!registered) {
        return Promise.resolve({
          error: `Plugin "${plugin}" not found. Available plugins: ${[...state.registry.plugins.keys()].join(', ') || '(none)'}`,
        });
      }

      const mapping = mergedTabs.get(plugin);
      return Promise.resolve([
        {
          plugin,
          displayName: registered.displayName,
          state: mapping?.state ?? 'closed',
          tabs: annotateTabsWithInstance(mapping?.tabs ?? [], registered.instanceMap),
        },
      ]);
    }

    const results: Array<{
      plugin: string;
      displayName: string;
      state: string;
      tabs: AnnotatedTab[];
    }> = [];

    for (const registered of state.registry.plugins.values()) {
      const mapping = mergedTabs.get(registered.name);
      results.push({
        plugin: registered.name,
        displayName: registered.displayName,
        state: mapping?.state ?? 'closed',
        tabs: annotateTabsWithInstance(mapping?.tabs ?? [], registered.instanceMap),
      });
    }

    return Promise.resolve(results);
  },
});

export { pluginListTabs };
