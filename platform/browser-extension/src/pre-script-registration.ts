/**
 * Pre-script content-script registration.
 *
 * Plugins may declare an optional pre-script that must run at `document_start`
 * in MAIN world, before any page JavaScript. This is the only Chrome injection
 * point that beats inline `<script>` tags in `<head>`, which is necessary for
 * capturing auth tokens or other transient early state that the page would
 * otherwise hide (e.g., Microsoft 365's Protected Token Cache encrypts MSAL
 * localStorage entries at rest, so post-load reads return nothing).
 *
 * Mechanism: `chrome.scripting.registerContentScripts` with
 *   runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true.
 *
 * Note: registered content scripts only fire on FUTURE navigations. Tabs
 * already open at registration time must be reloaded for the pre-script to
 * take effect. Caller policy decides whether to auto-reload.
 */

import { isValidPluginName } from './constants.js';
import type { PluginMeta } from './extension-messages.js';

/** Build the deterministic registration ID for a plugin's pre-script. */
const registrationId = (pluginName: string): string => `opentabs-pre-${pluginName}`;

/** Return the set of currently-registered pre-script IDs owned by this extension. */
const getRegisteredPreScriptIds = async (): Promise<Set<string>> => {
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = new Set<string>();
    for (const entry of registered) {
      if (entry.id.startsWith('opentabs-pre-')) ids.add(entry.id);
    }
    return ids;
  } catch (err) {
    console.warn('[opentabs] getRegisteredContentScripts failed:', err);
    return new Set();
  }
};

/**
 * Upsert a pre-script registration for a single plugin.
 * Unregisters the existing entry (if any) first so we can register fresh —
 * `registerContentScripts` rejects IDs that already exist. Any error in
 * unregister is ignored (common when the ID didn't exist yet).
 */
const upsertPreScript = async (meta: PluginMeta): Promise<void> => {
  if (!meta.preScriptFile) return;
  if (!isValidPluginName(meta.name)) return;
  if (meta.urlPatterns.length === 0) return;

  const id = registrationId(meta.name);

  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // Expected when not yet registered — ignore.
  }

  try {
    await chrome.scripting.registerContentScripts([
      {
        id,
        matches: meta.urlPatterns,
        excludeMatches: meta.excludePatterns,
        js: [meta.preScriptFile],
        runAt: 'document_start',
        world: 'MAIN',
        persistAcrossSessions: true,
        allFrames: false,
      },
    ]);
    console.info(`[opentabs] Registered pre-script ${id} (${meta.preScriptFile}) for ${meta.urlPatterns.join(',')}`);
  } catch (err) {
    console.warn(`[opentabs] registerContentScripts failed for ${id}:`, err);
  }
};

/** Unregister a pre-script for a plugin. No-op if not registered. */
const removePreScript = async (pluginName: string): Promise<void> => {
  const id = registrationId(pluginName);
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // Ignore — script may not have been registered.
  }
};

/**
 * Synchronize registered pre-scripts with the given plugin metadata list.
 * Registers pre-scripts for plugins that declare one, unregisters any
 * `opentabs-pre-*` registrations that no longer correspond to a known plugin.
 */
const syncPreScripts = async (plugins: readonly PluginMeta[]): Promise<void> => {
  const expectedIds = new Set<string>();
  const toUpsert: PluginMeta[] = [];
  for (const meta of plugins) {
    if (!meta.preScriptFile) continue;
    if (!isValidPluginName(meta.name)) continue;
    expectedIds.add(registrationId(meta.name));
    toUpsert.push(meta);
  }

  const currentIds = await getRegisteredPreScriptIds();

  const staleIds: string[] = [];
  for (const id of currentIds) {
    if (!expectedIds.has(id)) staleIds.push(id);
  }
  if (staleIds.length > 0) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: staleIds });
    } catch (err) {
      console.warn('[opentabs] failed to unregister stale pre-scripts:', err);
    }
  }

  await Promise.allSettled(toUpsert.map(upsertPreScript));
};

export { removePreScript, syncPreScripts, upsertPreScript };
