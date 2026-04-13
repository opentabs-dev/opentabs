import type { ToolPermission } from '@opentabs-dev/shared';
import { BROWSER_TOOLS_CATALOG } from '@opentabs-dev/shared/browser-tools-catalog';
import { Package, Search, ShieldOff, X } from 'lucide-react';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import { useEffect, useRef, useState } from 'react';
import type { DisconnectReason, InternalMessage } from '../extension-messages.js';
import type {
  BrowserToolState,
  FailedPluginState,
  FullStateResult,
  PluginSearchResult,
  PluginState,
} from './bridge.js';
import {
  setSkipPermissions as bridgeSetSkipPermissions,
  getFullState,
  installPlugin,
  removeFailedPlugin,
  removePlugin,
  searchPlugins,
  sendConfirmationResponse,
  updatePlugin,
} from './bridge.js';
import { BrowserToolsCard } from './components/BrowserToolsCard.js';
import type { ConfirmationData } from './components/ConfirmationDialog.js';
import { ConfirmationDialog } from './components/ConfirmationDialog.js';
import { DisconnectedState, LoadingState } from './components/EmptyStates.js';
import { ExtensionUpdateDialog } from './components/ExtensionUpdateDialog.js';
import { Footer } from './components/Footer.js';
import { PluginList } from './components/PluginList.js';
import { Accordion } from './components/retro/Accordion.js';
import { Empty } from './components/retro/Empty.js';
import { Input } from './components/retro/Input.js';
import { Tooltip } from './components/retro/Tooltip.js';
import { SearchResults } from './components/SearchResults.js';
import { ERROR_DISPLAY_DURATION_MS } from './constants.js';
import { useServerNotifications } from './hooks/useServerNotifications.js';

const App = () => {
  const [connected, setConnected] = useState(false);
  const [disconnectReason, setDisconnectReason] = useState<DisconnectReason | undefined>();
  const [plugins, setPlugins] = useState<PluginState[]>([]);
  const [failedPlugins, setFailedPlugins] = useState<FailedPluginState[]>([]);
  const [browserTools, setBrowserTools] = useState<BrowserToolState[]>(() =>
    BROWSER_TOOLS_CATALOG.map(t => ({ ...t, permission: 'auto' as const })),
  );
  const [browserPermission, setBrowserPermission] = useState<ToolPermission>('off');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | undefined>(undefined);
  const [serverSourcePath, setServerSourcePath] = useState<string | undefined>(undefined);
  const [extensionHash, setExtensionHash] = useState<string | undefined>(undefined);
  const [serverUpdate, setServerUpdate] = useState<{ latestVersion: string; updateCommand: string } | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [activeTools, setActiveTools] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingConfirmations, setPendingConfirmations] = useState<ConfirmationData[]>([]);
  const [npmResults, setNpmResults] = useState<PluginSearchResult[]>([]);
  const [npmSearching, setNpmSearching] = useState(false);
  const [npmSearchError, setNpmSearchError] = useState(false);
  const [installingPlugins, setInstallingPlugins] = useState<Set<string>>(new Set());
  const [removingPlugins, setRemovingPlugins] = useState<Set<string>>(new Set());
  const [removingFailedPlugins, setRemovingFailedPlugins] = useState<ReadonlySet<string>>(new Set());
  const [installErrors, setInstallErrors] = useState<Map<string, string>>(new Map());
  const [pluginErrors, setPluginErrors] = useState<Map<string, string>>(new Map());
  const [browserToolsOpen, setBrowserToolsOpen] = useState(false);
  const [browserToolsHydrated, setBrowserToolsHydrated] = useState(false);

  const pluginErrorTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const npmSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const npmSearchCounter = useRef(0);

  const connectedRef = useRef(connected);
  const loadingRef = useRef(loading);
  const pluginsRef = useRef(plugins);

  useEffect(() => {
    connectedRef.current = connected;
    loadingRef.current = loading;
    pluginsRef.current = plugins;
  }, [connected, loading, plugins]);

  const { handleNotification, clearSeenId, clearAllSeenIds } = useServerNotifications({
    setPlugins,
    setActiveTools,
    setPendingConfirmations,
  });

  useEffect(
    () => () => {
      for (const timer of pluginErrorTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    chrome.storage.session.get('browserToolsOpen').then(
      result => {
        const stored = result.browserToolsOpen as boolean | undefined;
        if (stored === true) setBrowserToolsOpen(true);
        setBrowserToolsHydrated(true);
      },
      () => {
        setBrowserToolsHydrated(true);
      },
    );
  }, []);

  const showPluginError = (pluginName: string, message: string) => {
    const existing = pluginErrorTimers.current.get(pluginName);
    if (existing) clearTimeout(existing);
    setPluginErrors(prev => new Map(prev).set(pluginName, message));
    pluginErrorTimers.current.set(
      pluginName,
      setTimeout(() => {
        setPluginErrors(prev => {
          const next = new Map(prev);
          next.delete(pluginName);
          return next;
        });
        pluginErrorTimers.current.delete(pluginName);
      }, ERROR_DISPLAY_DURATION_MS),
    );
  };

  const clearPluginError = (pluginName: string) => {
    const existing = pluginErrorTimers.current.get(pluginName);
    if (existing) {
      clearTimeout(existing);
      pluginErrorTimers.current.delete(pluginName);
    }
    setPluginErrors(prev => {
      const next = new Map(prev);
      next.delete(pluginName);
      return next;
    });
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    clearTimeout(npmSearchTimer.current);
    if (!query.trim()) {
      setNpmResults([]);
      setNpmSearching(false);
      setNpmSearchError(false);
      return;
    }
    setNpmSearching(true);
    const searchId = ++npmSearchCounter.current;
    npmSearchTimer.current = setTimeout(() => {
      searchPlugins(query)
        .then(result => {
          if (npmSearchCounter.current === searchId) {
            setNpmResults(result.results);
            setNpmSearchError(false);
          }
        })
        .catch(() => {
          if (npmSearchCounter.current === searchId) {
            setNpmResults([]);
            setNpmSearchError(true);
          }
        })
        .finally(() => {
          if (npmSearchCounter.current === searchId) {
            setNpmSearching(false);
          }
        });
    }, 400);
  };

  const handleInstall = (name: string) => {
    setInstallingPlugins(prev => new Set(prev).add(name));
    setInstallErrors(prev => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    installPlugin(name)
      .then(() => {
        setInstallingPlugins(prev => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        handleSearchChange('');
      })
      .catch((err: unknown) => {
        setInstallingPlugins(prev => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        setInstallErrors(prev => new Map(prev).set(name, err instanceof Error ? err.message : String(err)));
      });
  };

  const handleRemove = (pluginName: string) => {
    clearPluginError(pluginName);
    setRemovingPlugins(prev => new Set(prev).add(pluginName));
    removePlugin(pluginName)
      .then(() => {
        setRemovingPlugins(prev => {
          const next = new Set(prev);
          next.delete(pluginName);
          return next;
        });
      })
      .catch((err: unknown) => {
        setRemovingPlugins(prev => {
          const next = new Set(prev);
          next.delete(pluginName);
          return next;
        });
        showPluginError(pluginName, err instanceof Error ? err.message : String(err));
      });
  };

  const handleRemoveFailedPlugin = (specifier: string) => {
    setRemovingFailedPlugins(prev => new Set([...prev, specifier]));
    removeFailedPlugin(specifier)
      .then(() => {
        setRemovingFailedPlugins(prev => {
          const next = new Set(prev);
          next.delete(specifier);
          return next;
        });
      })
      .catch(() => {
        setRemovingFailedPlugins(prev => {
          const next = new Set(prev);
          next.delete(specifier);
          return next;
        });
      });
  };

  const handleUpdate = (pluginName: string) => {
    clearPluginError(pluginName);
    updatePlugin(pluginName).catch((err: unknown) => {
      showPluginError(pluginName, err instanceof Error ? err.message : String(err));
    });
  };

  useEffect(() => {
    /** Apply a full state snapshot from the background script to React state */
    const applyFullState = (result: FullStateResult): void => {
      setConnected(result.connected);
      setDisconnectReason(result.disconnectReason);
      setPlugins(result.plugins);
      setFailedPlugins(result.failedPlugins);
      setBrowserTools(() => {
        if (result.browserTools.length === 0) {
          return BROWSER_TOOLS_CATALOG.map(t => ({ ...t, permission: 'auto' as const }));
        }
        const serverNames = new Set(result.browserTools.map(t => t.name));
        const merged = [...result.browserTools];
        for (const local of BROWSER_TOOLS_CATALOG) {
          if (!serverNames.has(local.name)) merged.push({ ...local, permission: 'auto' as const });
        }
        return merged;
      });
      setBrowserPermission(result.browserPermission ?? 'off');
      setSkipPermissions(result.skipPermissions ?? false);
      setServerVersion(result.serverVersion);
      setServerSourcePath(result.serverSourcePath);
      setExtensionHash(result.extensionHash);
      setServerUpdate(result.serverUpdate);
      setActiveTools(prev => {
        const next = new Set<string>();
        for (const key of prev) {
          if (key.startsWith('browser:') || result.plugins.some(p => key.startsWith(`${p.name}:`))) {
            next.add(key);
          }
        }
        return next;
      });

      // Hydrate pending confirmations from the background. Replay each one
      // through handleNotification so deduplication tracking is registered.
      for (const c of result.pendingConfirmations ?? []) {
        handleNotification({
          method: 'confirmation.request',
          params: {
            id: c.id,
            tool: c.tool,
            plugin: c.plugin,
            params: c.params,
          },
        });
      }
    };

    void getFullState()
      .then(result => {
        applyFullState(result);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    const listener = (
      message: InternalMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ): boolean | undefined => {
      if (message.type === 'sp:getState') {
        const rootEl = document.getElementById('root');
        const html = rootEl ? rootEl.innerHTML.slice(0, 50000) : '';
        const currentPlugins = pluginsRef.current;
        sendResponse({
          state: {
            connected: connectedRef.current,
            loading: loadingRef.current,
            pluginCount: currentPlugins.length,
            plugins: currentPlugins.map(p => ({
              name: p.name,
              tabState: p.tabState,
            })),
          },
          html,
        });
        return true;
      }

      if (message.type === 'sp:connectionState') {
        const isConnected = message.data.connected;
        setConnected(isConnected);
        setDisconnectReason(isConnected ? undefined : message.data.disconnectReason);
        if (isConnected) {
          void getFullState()
            .then(applyFullState)
            .catch(() => {});
        } else {
          setPlugins([]);
          setFailedPlugins([]);
          setBrowserTools(BROWSER_TOOLS_CATALOG.map(t => ({ ...t, permission: 'auto' as const })));
          setBrowserPermission('off');
          setSkipPermissions(false);
          setServerVersion(undefined);
          setServerSourcePath(undefined);
          setExtensionHash(undefined);
          setServerUpdate(undefined);
          setActiveTools(new Set());
          setPendingConfirmations([]);
          clearAllSeenIds();
          setSearchQuery('');
          clearTimeout(npmSearchTimer.current);
          setNpmResults([]);
          setNpmSearching(false);
          setNpmSearchError(false);
          setInstallingPlugins(new Set());
          setRemovingPlugins(new Set());
          setRemovingFailedPlugins(new Set());
          setInstallErrors(new Map());
          for (const timer of pluginErrorTimers.current.values()) clearTimeout(timer);
          pluginErrorTimers.current.clear();
          setPluginErrors(new Map());
        }
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === 'sp:serverMessage') {
        const data = message.data;

        if (data.method === 'plugins.changed') {
          void getFullState()
            .then(applyFullState)
            .catch(() => {});
          sendResponse({ ok: true });
          return true;
        }

        handleNotification(data);
        sendResponse({ ok: true });
        return true;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      clearTimeout(npmSearchTimer.current);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [handleNotification, clearAllSeenIds]);

  const handleConfirmationRespond = (id: string, decision: 'allow' | 'deny', alwaysAllow?: boolean) => {
    sendConfirmationResponse(id, decision, alwaysAllow);
    setPendingConfirmations(prev => prev.filter(c => c.id !== id));
    clearSeenId(id);
  };

  const hasContent = plugins.length > 0 || failedPlugins.length > 0 || browserTools.length > 0;
  const showPlugins = !loading && connected && (hasContent || !!searchQuery);
  const showSearchBar = connected && !loading;

  const runningHash = (window as unknown as Record<string, unknown>).__EXTENSION_HASH__ as string | undefined;
  const showUpdateDialog =
    connected && extensionHash !== undefined && runningHash !== undefined && extensionHash !== runningHash;

  return (
    <Tooltip.Provider>
      <div className="flex h-screen flex-col overflow-hidden text-foreground">
        <ExtensionUpdateDialog open={showUpdateDialog} />
        {connected && <ConfirmationDialog confirmations={pendingConfirmations} onRespond={handleConfirmationRespond} />}
        {skipPermissions && (
          <div className="shrink-0 border-destructive border-b-2 bg-destructive/15 px-4 py-1.5">
            <div className="flex items-center gap-1.5">
              <ShieldOff className="h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="font-head text-destructive text-xs uppercase">Approvals skipped</span>
            </div>
            <p className="mt-0.5 text-[11px] text-foreground/70 leading-tight">
              AI runs tools without asking. Off tools stay off. Set by{' '}
              <code className="font-mono">OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS</code>.
            </p>
            <button
              type="button"
              onClick={() => void bridgeSetSkipPermissions(false)}
              className="mt-0.5 cursor-pointer font-head text-[11px] text-destructive underline hover:text-destructive/80">
              Restore approvals
            </button>
          </div>
        )}
        {showSearchBar && (
          <div className="shrink-0 px-4 pt-4 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search plugins and tools..."
                className="pr-8 pl-9"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => handleSearchChange('')}
                  className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <OverlayScrollbarsComponent
          className="flex-1"
          style={{ height: 0 }}
          options={{
            scrollbars: {
              theme: 'os-theme-retro',
              autoHide: 'scroll',
              autoHideDelay: 600,
            },
          }}>
          <main
            className={`px-4 pb-4 ${showSearchBar ? 'pt-2' : 'pt-4'} ${showPlugins ? '' : 'flex min-h-full items-center justify-center'}`}>
            {loading ? (
              <LoadingState />
            ) : !connected ? (
              <DisconnectedState reason={disconnectReason} />
            ) : searchQuery ? (
              <SearchResults
                plugins={plugins}
                failedPlugins={failedPlugins}
                browserTools={browserTools}
                activeTools={activeTools}
                setPlugins={setPlugins}
                setBrowserTools={setBrowserTools}
                toolFilter={searchQuery}
                npmResults={npmResults}
                npmSearching={npmSearching}
                npmSearchError={npmSearchError}
                installingPlugins={installingPlugins}
                onInstall={handleInstall}
                installErrors={installErrors}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
                removingPlugins={removingPlugins}
                pluginErrors={pluginErrors}
                serverVersion={serverVersion}
                browserPermission={browserPermission}
                onBrowserPermissionChange={setBrowserPermission}
              />
            ) : hasContent ? (
              <>
                {browserTools.length > 0 && browserToolsHydrated && (
                  <Accordion
                    type="multiple"
                    value={browserToolsOpen ? ['browser-tools'] : []}
                    onValueChange={val => {
                      const isOpen = val.includes('browser-tools');
                      setBrowserToolsOpen(isOpen);
                      chrome.storage.session.set({ browserToolsOpen: isOpen }).catch(() => {});
                    }}
                    className="mb-2 space-y-2">
                    <BrowserToolsCard
                      tools={browserTools}
                      activeTools={activeTools}
                      onToolsChange={setBrowserTools}
                      serverVersion={serverVersion}
                      serverSourcePath={serverSourcePath}
                      serverUpdate={serverUpdate}
                      browserPermission={browserPermission}
                      onBrowserPermissionChange={setBrowserPermission}
                    />
                  </Accordion>
                )}
                <PluginList
                  plugins={plugins}
                  failedPlugins={failedPlugins}
                  activeTools={activeTools}
                  setPlugins={setPlugins}
                  toolFilter=""
                  onUpdate={handleUpdate}
                  onRemove={handleRemove}
                  removingPlugins={removingPlugins}
                  pluginErrors={pluginErrors}
                  onRemoveFailedPlugin={handleRemoveFailedPlugin}
                  removingFailedPlugins={removingFailedPlugins}
                />
                {plugins.length === 0 && failedPlugins.length === 0 && (
                  <Empty className="border-muted" role="status">
                    <Empty.Content>
                      <Empty.Icon className="h-10 w-10 text-muted-foreground">
                        <Package size={40} />
                      </Empty.Icon>
                      <Empty.Title className="text-base">No Plugins Installed</Empty.Title>
                      <Empty.Separator />
                      <Empty.Description className="text-xs">
                        Use the search bar above to discover and install plugins from npm.
                      </Empty.Description>
                    </Empty.Content>
                  </Empty>
                )}
              </>
            ) : null}
          </main>
        </OverlayScrollbarsComponent>
        <Footer />
      </div>
    </Tooltip.Provider>
  );
};

export { App };
