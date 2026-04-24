import type { PluginMeta } from './extension-messages.js';

const SCRIPT_ID_PREFIX = 'opentabs-pre-';

const scriptId = (pluginName: string): string => `${SCRIPT_ID_PREFIX}${pluginName}`;

const buildScript = (meta: PluginMeta, preScriptFile: string): chrome.scripting.RegisteredContentScript => ({
  id: scriptId(meta.name),
  js: [preScriptFile],
  matches: meta.urlPatterns,
  runAt: 'document_start',
  world: 'MAIN',
  persistAcrossSessions: true,
  ...(meta.excludePatterns && meta.excludePatterns.length > 0 ? { excludeMatches: meta.excludePatterns } : {}),
});

/**
 * Sync all pre-script registrations with the given plugin metadata.
 *
 * Unregisters stale entries and registers/updates current ones via
 * chrome.scripting. Chrome wipes registerContentScripts registrations on
 * extension update regardless of persistAcrossSessions:true, so this must be
 * called on onInstalled, onStartup, and module init in addition to the
 * sync.full and plugin.update paths.
 */
export const syncPreScripts = async (metas: PluginMeta[]): Promise<void> => {
  // Build desired set: plugins that declare a pre-script with non-empty URL patterns.
  const desired = new Map<string, { meta: PluginMeta; preScriptFile: string }>();
  for (const meta of metas) {
    if (meta.preScriptFile && meta.urlPatterns.length > 0) {
      desired.set(meta.name, { meta, preScriptFile: meta.preScriptFile });
    }
  }

  // Get currently registered content scripts managed by opentabs.
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ours = registered.filter(s => s.id.startsWith(SCRIPT_ID_PREFIX));
  const registeredMap = new Map(ours.map(s => [s.id, s]));

  // Unregister stale entries (registered but not in desired set).
  const staleIds = ours.filter(s => !desired.has(s.id.slice(SCRIPT_ID_PREFIX.length))).map(s => s.id);
  if (staleIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: staleIds });
  }

  // Register new entries and update existing ones.
  const toRegister: chrome.scripting.RegisteredContentScript[] = [];
  const toUpdate: chrome.scripting.RegisteredContentScript[] = [];
  for (const [name, { meta, preScriptFile }] of desired) {
    const id = scriptId(name);
    const script = buildScript(meta, preScriptFile);
    if (registeredMap.has(id)) {
      toUpdate.push(script);
    } else {
      toRegister.push(script);
    }
  }

  if (toUpdate.length > 0) {
    await chrome.scripting.updateContentScripts(toUpdate);
  }
  if (toRegister.length > 0) {
    await chrome.scripting.registerContentScripts(toRegister);
  }
};

/**
 * Register or update the pre-script for a single plugin.
 *
 * If the plugin has no preScriptFile or empty urlPatterns, any existing
 * registration for that plugin is removed.
 */
export const upsertPreScript = async (meta: PluginMeta): Promise<void> => {
  const id = scriptId(meta.name);

  if (!meta.preScriptFile || meta.urlPatterns.length === 0) {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    }
    return;
  }

  const script = buildScript(meta, meta.preScriptFile);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length > 0) {
    await chrome.scripting.updateContentScripts([script]);
  } else {
    await chrome.scripting.registerContentScripts([script]);
  }
};
