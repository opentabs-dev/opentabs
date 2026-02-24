import { INJECTION_RETRY_DELAY_MS, isValidPluginName } from './constants.js';
import { getAllPluginMeta } from './plugin-storage.js';
import { urlMatchesPatterns } from './tab-matching.js';
import { toErrorMessage } from '@opentabs-dev/shared';

/** Names reserved for platform use — rejected at the injection layer as defense-in-depth */
const RESERVED_NAMES = new Set(['system', 'browser', 'opentabs', 'extension', 'config', 'plugin', 'tool', 'mcp']);

const isSafePluginName = (name: string): boolean => isValidPluginName(name) && !RESERVED_NAMES.has(name);

/** Check if an adapter for the given plugin is already injected in a tab */
const isAdapterPresent = async (tabId: number, pluginName: string): Promise<boolean> => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (pName: string) => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.[pName] !== undefined;
      },
      args: [pluginName],
    });
    const first = results[0] as { result?: unknown } | undefined;
    return first?.result === true;
  } catch (err) {
    console.warn(`[opentabs] isAdapterPresent failed for tab ${String(tabId)}, plugin ${pluginName}:`, err);
    return false;
  }
};

/**
 * Verify that the injected adapter reports the expected version.
 * Returns true if versions match, false on mismatch or failure.
 * Logs a warning on mismatch so the injection pipeline continues.
 */
const verifyAdapterVersion = async (tabId: number, pluginName: string, expectedVersion: string): Promise<boolean> => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (pName: string) => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, { version?: string }> }
          | undefined;
        return ot?.adapters?.[pName]?.version;
      },
      args: [pluginName],
    });
    const first = results[0] as { result?: unknown } | undefined;
    const version = first?.result;
    if (version !== expectedVersion) {
      console.warn(
        `[opentabs] Adapter version mismatch for ${pluginName}: expected ${expectedVersion}, got ${String(version)}`,
      );
      return false;
    }
    return true;
  } catch {
    console.warn(`[opentabs] Failed to verify adapter version for ${pluginName}`);
    return false;
  }
};

/** Read the adapter hash from the page for a given plugin. Returns undefined on failure. */
const readAdapterHash = async (tabId: number, pluginName: string): Promise<string | undefined> => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (pName: string) => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, { __adapterHash?: string }> }
          | undefined;
        return ot?.adapters?.[pName]?.__adapterHash;
      },
      args: [pluginName],
    });
    const first = results[0] as { result?: unknown } | undefined;
    return typeof first?.result === 'string' ? first.result : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Verify that the injected adapter's content hash matches the expected hash.
 * Returns true if hashes match, false otherwise. Does not throw.
 */
const verifyAdapterHash = async (tabId: number, pluginName: string, expectedHash: string): Promise<boolean> => {
  const hash = await readAdapterHash(tabId, pluginName);
  return hash === expectedHash;
};

/**
 * Inject a log relay listener into a tab's ISOLATED world.
 * Listens for 'opentabs:plugin-logs' postMessages from the MAIN world adapter
 * and forwards batched log entries to the background via chrome.runtime.sendMessage.
 *
 * A per-tab cryptographic nonce prevents malicious page scripts from spoofing
 * log entries. The nonce is generated here and shared with both worlds:
 * - ISOLATED world: validates `data.nonce` on every received postMessage
 * - MAIN world: stored on `globalThis.__openTabs._logNonce`, read by the
 *   adapter IIFE's flushLogs() and included in every postMessage call
 */
const injectLogRelay = async (tabId: number): Promise<void> => {
  const nonce = crypto.randomUUID();

  try {
    // 1. Install the ISOLATED world listener with the nonce for validation
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: (n: string) => {
        // Idempotent guard: only register the listener once per tab.
        // When re-invoked (e.g., on re-injection), the existing listener
        // stays in place — the new nonce is injected into MAIN world so
        // the adapter picks it up, and the ISOLATED listener accepts
        // messages with ANY previously registered nonce via a Set.
        const guard = '__opentabs_log_relay';
        const win = window as unknown as Record<string, unknown>;
        if (win[guard]) {
          // Add the new nonce to the accepted set
          const nonceSet = win.__opentabs_log_nonces as Set<string> | undefined;
          if (nonceSet) nonceSet.add(n);
          return;
        }
        win[guard] = true;

        const nonces = new Set<string>([n]);
        win.__opentabs_log_nonces = nonces;

        window.addEventListener('message', event => {
          if (event.source !== window) return;
          const data = event.data as Record<string, unknown> | undefined;
          if (!data || data.type !== 'opentabs:plugin-logs') return;
          if (typeof data.nonce !== 'string' || !nonces.has(data.nonce)) return;
          const plugin = data.plugin;
          const entries = data.entries;
          if (typeof plugin !== 'string' || !Array.isArray(entries) || entries.length === 0) return;
          chrome.runtime.sendMessage({ type: 'plugin:logs', plugin, entries }).catch(() => {
            // Background may not be listening — drop silently
          });
        });
      },
      args: [nonce],
    });

    // 2. Inject the nonce into MAIN world on globalThis.__openTabs._logNonce.
    //    The adapter IIFE reads this value in its flushLogs() function and
    //    includes it in every postMessage call. On re-injection, the nonce is
    //    updated so the adapter picks up the new value on the next flush.
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (n: string) => {
        const ot = ((globalThis as Record<string, unknown>).__openTabs ?? {}) as Record<string, unknown>;
        (globalThis as Record<string, unknown>).__openTabs = ot;
        ot._logNonce = n;
      },
      args: [nonce],
    });
  } catch (err) {
    console.warn(`[opentabs] injectLogRelay failed for tab ${String(tabId)}:`, err);
  }
};

/**
 * Inject an adapter file into a single tab via chrome.scripting.executeScript.
 *
 * Uses the `files` option to inject the pre-built adapter IIFE from the
 * extension's adapters/ directory. This bypasses all page CSP restrictions
 * because file-based injection is not subject to page CSP.
 */
const injectAdapterFile = async (
  tabId: number,
  pluginName: string,
  version?: string,
  adapterHash?: string,
): Promise<void> => {
  // Inject the log relay in ISOLATED world before the adapter IIFE (MAIN world)
  // so postMessage listeners are in place when the adapter starts logging.
  await injectLogRelay(tabId);

  const adapterFile = `adapters/${pluginName}.js`;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: [adapterFile],
    });
  } catch (err) {
    throw new Error(`Failed to inject adapter file '${adapterFile}' into tab ${String(tabId)}: ${toErrorMessage(err)}`);
  }

  if (version) {
    await verifyAdapterVersion(tabId, pluginName, version);
  }

  if (adapterHash) {
    const hashMatched = await verifyAdapterHash(tabId, pluginName, adapterHash);
    if (!hashMatched) {
      // Retry once after a short delay — the file may have been partially written
      await new Promise(resolve => setTimeout(resolve, INJECTION_RETRY_DELAY_MS));
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: [adapterFile],
        });
      } catch (err) {
        throw new Error(
          `Failed to re-inject adapter file '${adapterFile}' into tab ${String(tabId)}: ${toErrorMessage(err)}`,
        );
      }
      if (version) {
        await verifyAdapterVersion(tabId, pluginName, version);
      }

      const retryMatched = await verifyAdapterHash(tabId, pluginName, adapterHash);
      if (!retryMatched) {
        const actualHash = await readAdapterHash(tabId, pluginName);
        throw new Error(
          `Adapter hash mismatch for ${pluginName} after retry: expected ${adapterHash}, got ${String(actualHash)}`,
        );
      }
    }
  }
};

/**
 * Collect all unique tab IDs matching the given URL patterns.
 * Queries each pattern independently and deduplicates by tab ID.
 */
const queryMatchingTabIds = async (urlPatterns: string[]): Promise<number[]> => {
  const tabIds = new Set<number>();
  for (const pattern of urlPatterns) {
    try {
      const tabs = await chrome.tabs.query({ url: pattern });
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          tabIds.add(tab.id);
        }
      }
    } catch (err) {
      console.warn(`[opentabs] chrome.tabs.query failed for pattern ${pattern}:`, err);
    }
  }
  return Array.from(tabIds);
};

/**
 * Call an adapter's teardown() function in a tab via chrome.scripting.executeScript.
 * Swallows errors — the injection pipeline continues regardless of teardown outcome.
 */
const teardownAdapterInTab = async (tabId: number, pluginName: string): Promise<void> => {
  await chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (pName: string) => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, { teardown?: () => void }> }
          | undefined;
        const adapter = ot?.adapters?.[pName];
        if (adapter && typeof adapter.teardown === 'function') {
          try {
            adapter.teardown();
          } catch (e) {
            console.warn('[opentabs] teardown error:', e);
          }
        }
      },
      args: [pluginName],
    })
    .catch((err: unknown) => {
      console.warn(`[opentabs] adapter teardown script failed for ${pluginName}:`, err);
    });
};

/**
 * Injects a plugin's adapter IIFE into all tabs matching its URL patterns.
 *
 * @param pluginName - The plugin's unique name (validated against reserved names)
 * @param urlPatterns - Chrome match patterns identifying which tabs to inject into
 * @param forceReinject - When `true`, re-inject even if the adapter is already
 *   present (used by plugin.update to overwrite stale adapter code). When `false`
 *   (default), tabs that already have the adapter are skipped.
 * @param version - Expected adapter version string for post-injection verification
 * @param adapterHash - Expected content hash for post-injection integrity check
 * @returns Tab IDs where injection succeeded
 */
const injectPluginIntoMatchingTabs = async (
  pluginName: string,
  urlPatterns: string[],
  forceReinject = false,
  version?: string,
  adapterHash?: string,
): Promise<number[]> => {
  if (!isSafePluginName(pluginName)) {
    console.warn(`[opentabs] Skipping injection for unsafe plugin name: ${pluginName}`);
    return [];
  }

  const tabIds = await queryMatchingTabIds(urlPatterns);

  // Process all tabs in parallel: check presence + inject
  const results = await Promise.allSettled(
    tabIds.map(async tabId => {
      if (!forceReinject && (await isAdapterPresent(tabId, pluginName))) {
        return tabId;
      }

      // Belt-and-suspenders with the IIFE wrapper's self-teardown:
      // call teardown from the extension side first, so cleanup happens even
      // if the adapter was injected by an older SDK version without wrapper
      // teardown support.
      if (forceReinject) {
        await teardownAdapterInTab(tabId, pluginName);
      }

      await injectAdapterFile(tabId, pluginName, version, adapterHash);
      return tabId;
    }),
  );

  const injectedTabIds: number[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      injectedTabIds.push(result.value);
    }
  }

  return injectedTabIds;
};

/**
 * Injects all stored plugins whose URL patterns match the given tab.
 * Called on `chrome.tabs.onUpdated` (status=complete) so that tabs opened
 * after `sync.full` still get their adapter files.
 *
 * @param tabId - The Chrome tab ID to inject adapters into
 * @param tabUrl - The tab's current URL, used to filter plugins by URL pattern match
 */
const injectPluginsIntoTab = async (tabId: number, tabUrl: string): Promise<void> => {
  const index = await getAllPluginMeta();
  const plugins = Object.values(index);

  if (plugins.length === 0) return;

  // Filter to plugins whose URL patterns match this tab and have safe names
  const matching = plugins.filter(p => isSafePluginName(p.name) && urlMatchesPatterns(tabUrl, p.urlPatterns));
  if (matching.length === 0) return;

  // Check presence for all matching plugins in parallel
  const presenceResults = await Promise.allSettled(
    matching.map(async plugin => ({
      plugin,
      present: await isAdapterPresent(tabId, plugin.name),
    })),
  );

  const needsInjection = presenceResults
    .filter(
      (r): r is PromiseFulfilledResult<{ plugin: (typeof matching)[0]; present: boolean }> =>
        r.status === 'fulfilled' && !r.value.present,
    )
    .map(r => r.value.plugin);

  if (needsInjection.length === 0) return;

  // Inject all needed plugins in parallel
  await Promise.allSettled(
    needsInjection.map(async plugin => {
      try {
        await injectAdapterFile(tabId, plugin.name, plugin.version, plugin.adapterHash);
      } catch (err) {
        console.warn(`[opentabs] Injection failed for tab ${String(tabId)}, plugin ${plugin.name}:`, err);
      }
    }),
  );
};

/**
 * Removes an injected adapter from all tabs matching the plugin's URL patterns.
 * Calls the adapter's `teardown()` function and deletes it from `__openTabs.adapters`.
 *
 * @param pluginName - The plugin whose adapter should be removed
 * @param urlPatterns - Chrome match patterns identifying which tabs to clean up
 */
const cleanupAdaptersInMatchingTabs = async (pluginName: string, urlPatterns: string[]): Promise<void> => {
  if (!isSafePluginName(pluginName)) {
    console.warn(`[opentabs] Skipping cleanup for unsafe plugin name: ${pluginName}`);
    return;
  }

  const tabIds = await queryMatchingTabIds(urlPatterns);

  // Run cleanup scripts in parallel across all matching tabs
  await Promise.allSettled(
    tabIds.map(async tabId => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (pName: string) => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, { teardown?: () => void }> }
              | undefined;
            const adapters = ot?.adapters;
            if (!adapters) return;
            const adapter = adapters[pName];
            if (adapter) {
              if (typeof adapter.teardown === 'function') {
                try {
                  adapter.teardown();
                } catch (e) {
                  console.warn('[opentabs] teardown error:', e);
                }
              }
              // Attempt deletion; if the property is non-configurable (locked
              // by hashAndFreeze), rebuild the adapters container without the
              // removed plugin and replace __openTabs on globalThis.
              if (!Reflect.deleteProperty(adapters, pName)) {
                const newAdapters: Record<string, unknown> = {};
                for (const key of Object.keys(adapters)) {
                  if (key !== pName) {
                    const desc = Object.getOwnPropertyDescriptor(adapters, key);
                    if (desc) Object.defineProperty(newAdapters, key, desc);
                  }
                }
                delete (globalThis as Record<string, unknown>).__openTabs;
                (globalThis as Record<string, unknown>).__openTabs = Object.assign({}, ot, {
                  adapters: newAdapters,
                });
              }
            }
          },
          args: [pluginName],
        });
      } catch (err) {
        console.warn(`[opentabs] Cleanup failed for tab ${String(tabId)}, plugin ${pluginName}:`, err);
      }
    }),
  );
};

/**
 * Re-injects all stored plugins into their matching tabs on extension startup.
 * Runs all plugin injections in parallel, logging warnings for any failures.
 */
const reinjectStoredPlugins = async (): Promise<void> => {
  const index = await getAllPluginMeta();
  const plugins = Object.values(index);
  if (plugins.length === 0) return;

  const results = await Promise.allSettled(
    plugins.map(plugin =>
      injectPluginIntoMatchingTabs(plugin.name, plugin.urlPatterns, false, plugin.version, plugin.adapterHash),
    ),
  );
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && result.status === 'rejected') {
      const plugin = plugins[i];
      console.warn(`[opentabs] Failed to reinject stored plugin ${plugin?.name ?? 'unknown'}:`, result.reason);
    }
  }
};

export {
  cleanupAdaptersInMatchingTabs,
  injectPluginIntoMatchingTabs,
  injectPluginsIntoTab,
  isSafePluginName,
  queryMatchingTabIds,
  reinjectStoredPlugins,
  teardownAdapterInTab,
  verifyAdapterVersion,
};
